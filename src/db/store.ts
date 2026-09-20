/**
 * The one place that mutates data.
 *
 * Everything is held in memory and written through to IndexedDB. A personal tracker's
 * whole history is a few thousand rows, so keeping it resident makes rendering and
 * streak recomputation trivial and removes every loading state from the UI.
 *
 * Deletes are soft: a row keeps its id and gains a `deletedAt`, so a deletion on one
 * device survives the trip to the other. Nothing here reads `deletedAt === null` for
 * you — selectors do that.
 */

import { addDayKey, compareDayKeys, dayKeyFor, dayMinuteFor, type DayConfig } from '../core/dayKey'
import { DEDUPE_DAYS, selectPick } from '../core/reading'
import { splitSession } from '../core/sessionSplit'
import { fetchCandidates } from './readSources'
import { normalizeGroup } from '../core/grouping'
import { repack as computeRepack } from '../core/repack'
import { DEFAULT_SETTINGS, type Block, type DailyRead, type DayPlan, type Entry, type OwnerType, type Phase, type Project, type Schedule, type Settings, type Task, type Todo } from '../core/types'
import { getAll, getMeta, putMany, setMeta } from './idb'

export interface Snapshot {
  ready: boolean
  tasks: Task[]
  entries: Entry[]
  todos: Todo[]
  dayPlans: DayPlan[]
  blocks: Block[]
  projects: Project[]
  phases: Phase[]
  dailyReads: DailyRead[]
  settings: Settings
}

const EMPTY: Snapshot = {
  ready: false,
  tasks: [],
  entries: [],
  todos: [],
  dayPlans: [],
  blocks: [],
  projects: [],
  phases: [],
  dailyReads: [],
  settings: DEFAULT_SETTINGS,
}

const nowIso = (): string => new Date().toISOString()
const uuid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`

const stamp = <T extends { updatedAt: string }>(row: T): T => ({ ...row, updatedAt: nowIso() })

/** Below this, a finished session is a mis-tap rather than something you did. */
const MIN_LOGGED_SECONDS = 60

/**
 * How many days one session may write blocks across.
 *
 * A timer left running over a weekend splits into a slice per day, and a block on each
 * of them is noise rather than a record. Two covers the real case — a session that ran
 * past 04:00 — and discards the rest.
 */
const MAX_LOGGED_DAYS = 2

/**
 * Bring a stored task up to the current shape.
 *
 * `Schedule.timesPerWeek(n)` was deleted: it claimed "any n days this week" but was
 * implemented as "scheduled every day". The honest equivalent is a daily schedule with a
 * weekly `atLeast n` goal, so that is what it becomes. This runs on read, so it must ship
 * with or before the type change — never after, or stored tasks fail to parse.
 *
 * Defaults for fields added later belong here too. `load` runs this over everything out
 * of IndexedDB, and sync reloads through `load` after a pull, so a task written by an
 * older build — or by another device still on one — arrives with the field filled in
 * rather than `undefined` masquerading as a boolean.
 */
function migrateTask(raw: Task): Task {
  const legacy = raw.schedule as Schedule | { type: 'timesPerWeek'; n: number } | undefined
  if (legacy && legacy.type === 'timesPerWeek') {
    return {
      ...raw,
      schedule: { type: 'daily' },
      goalPeriod: 'week',
      goalDirection: 'atLeast',
      goalValue: legacy.n,
    }
  }
  return { ...raw, goalPeriod: raw.goalPeriod ?? 'day', logToPlan: raw.logToPlan ?? false }
}

type Collection = 'tasks' | 'entries' | 'todos' | 'dayPlans' | 'blocks' | 'projects' | 'phases' | 'dailyReads'

export class TallyStore {
  private state: Snapshot = EMPTY
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): Snapshot => this.state

  private emit(next: Partial<Snapshot>): void {
    this.state = { ...this.state, ...next }
    for (const fn of this.listeners) fn()
  }

  get dayConfig(): DayConfig {
    return { dayStartMinute: this.state.settings.dayStartMinute, timeZone: this.state.settings.timeZone }
  }

  get weekStartDay(): number {
    return this.state.settings.weekStartDay
  }

  todayKey(now: Date | number = Date.now()): string {
    return dayKeyFor(now, this.dayConfig)
  }

  async load(): Promise<void> {
    const [tasks, entries, todos, dayPlans, blocks, projects, phases, dailyReads, settings] = await Promise.all([
      getAll<Task>('tasks'),
      getAll<Entry>('entries'),
      getAll<Todo>('todos'),
      getAll<DayPlan>('dayPlans'),
      getAll<Block>('blocks'),
      getAll<Project>('projects'),
      getAll<Phase>('phases'),
      getAll<DailyRead>('dailyReads'),
      getMeta<Settings>('settings'),
    ])
    this.emit({
      ready: true,
      tasks: tasks.map(migrateTask),
      entries,
      todos,
      dayPlans,
      blocks,
      projects,
      phases,
      dailyReads,
      // an explicit choice in Settings wins; otherwise the Eastern default applies
      settings: { ...DEFAULT_SETTINGS, ...settings, timeZone: settings?.timeZone || DEFAULT_SETTINGS.timeZone },
    })
  }

  /** Upsert rows into memory and IndexedDB in one step. */
  private async persist<T extends { id: string }>(collection: Collection, rows: T[]): Promise<void> {
    if (rows.length === 0) return
    const current = this.state[collection] as unknown as T[]
    const byId = new Map(current.map((r) => [r.id, r]))
    for (const row of rows) byId.set(row.id, row)
    this.emit({ [collection]: [...byId.values()] } as unknown as Partial<Snapshot>)
    await putMany(collection, rows)
  }

  // ---------------------------------------------------------------- settings

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = { ...this.state.settings, ...patch }
    this.emit({ settings })
    await setMeta('settings', settings)
  }

  // ------------------------------------------------------------------- tasks

  async createTask(input: Partial<Task> & Pick<Task, 'title' | 'kind'>): Promise<Task> {
    const maxOrder = this.state.tasks.reduce((m, t) => Math.max(m, t.sortOrder), -1)
    const task: Task = {
      id: uuid(),
      updatedAt: nowIso(),
      deletedAt: null,
      title: input.title,
      kind: input.kind,
      goalDirection: input.goalDirection ?? 'none',
      goalPeriod: input.goalPeriod ?? 'day',
      goalValue: input.goalValue ?? null,
      unitLabel: input.unitLabel ?? '',
      schedule: input.schedule ?? { type: 'daily' },
      quickAdds: input.quickAdds ?? [],
      colorHex: input.colorHex ?? '#4F46E5',
      symbolName: input.symbolName ?? 'circle',
      sortOrder: input.sortOrder ?? maxOrder + 1,
      logToPlan: input.logToPlan ?? false,
      isArchived: false,
      createdAt: nowIso(),
    }
    await this.persist('tasks', [task])
    return task
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id)
    if (!task) return
    await this.persist('tasks', [stamp({ ...task, ...patch, id: task.id })])
  }

  /** Soft-deletes the task and everything logged against it, in one pass. */
  async deleteTask(id: string): Promise<void> {
    const at = nowIso()
    const task = this.state.tasks.find((t) => t.id === id)
    if (!task) return
    await this.persist('tasks', [{ ...task, deletedAt: at, updatedAt: at }])
    const owned = this.state.entries.filter((e) => e.ownerType === 'task' && e.ownerId === id && !e.deletedAt)
    await this.persist('entries', owned.map((e) => ({ ...e, deletedAt: at, updatedAt: at })))
  }

  async reorderTasks(orderedIds: readonly string[]): Promise<void> {
    const rows: Task[] = []
    orderedIds.forEach((id, i) => {
      const t = this.state.tasks.find((x) => x.id === id)
      if (t && t.sortOrder !== i) rows.push(stamp({ ...t, sortOrder: i }))
    })
    await this.persist('tasks', rows)
  }

  // ----------------------------------------------------------------- entries

  private newEntry(ownerType: OwnerType, ownerId: string, over: Partial<Entry> = {}): Entry {
    return {
      id: uuid(),
      updatedAt: nowIso(),
      deletedAt: null,
      ownerType,
      ownerId,
      dayKey: this.todayKey(),
      startedAt: null,
      endedAt: null,
      amount: 0,
      note: '',
      isSkip: false,
      createdAt: nowIso(),
      ...over,
    }
  }

  runningEntries(): Entry[] {
    return this.state.entries.filter((e) => !e.deletedAt && e.startedAt !== null && e.endedAt === null)
  }

  /**
   * Start a timer.
   *
   * A task may only have one running session, so starting a second ends the first.
   * Blocks are stricter: only one block runs at a time across the whole plan, and
   * starting one never disturbs a running task timer.
   */
  /**
   * End one running session. The only place `endedAt` is ever set.
   *
   * There are two ways a session ends: the stop button, and starting a task that is
   * already running, which silently ends the first run. That second path used to set
   * `endedAt` inline here in `startTimer`, so anything hung off the end of a session had
   * to be written twice or it would quietly not happen on the restart — the case a user
   * hits by double-tapping and then cannot explain. One funnel, one place to hook.
   *
   * Idempotent: an entry that has already ended is left alone.
   */
  private async finishEntry(entry: Entry, at: string): Promise<void> {
    if (entry.endedAt) return
    const ended = { ...entry, endedAt: at, updatedAt: at }
    // the session is recorded first and unconditionally: if writing the block fails,
    // the time you spent is still yours
    await this.persist('entries', [ended])
    await this.logSessionToPlan(ended)
  }

  /**
   * Put a finished session on the day's schedule, if its task asked to be there.
   *
   * Only task timers. A block can own a timer too, and logging that would have the
   * schedule growing a copy of a block every time you ran one.
   *
   * The times are the real ones, to the minute and unsnapped — the canvas rounds to its
   * fifteen-minute grid when it draws, but what is stored is what happened. `dayMinuteFor`
   * rather than subtracting the day's start, so the two DST days a year land in the right
   * slot rather than an hour out.
   *
   * A session that crosses 04:00 becomes one block per day it touches: `splitSession`
   * already does that arithmetic for the stats, and the start offsets fall out of it —
   * only the first slice begins part-way through a day, and every later one begins at
   * midnight-of-the-tally-day, which is minute zero.
   */
  private async logSessionToPlan(entry: Entry): Promise<void> {
    if (entry.ownerType !== 'task' || !entry.startedAt || !entry.endedAt) return
    const task = this.state.tasks.find((t) => t.id === entry.ownerId && !t.deletedAt)
    if (!task?.logToPlan) return

    const started = Date.parse(entry.startedAt)
    const ended = Date.parse(entry.endedAt)
    if (!Number.isFinite(started) || !Number.isFinite(ended)) return
    // a tap on play and straight back off is not a session, it is a mis-tap
    if (ended - started < MIN_LOGGED_SECONDS * 1000) return

    const cfg = this.dayConfig
    const slices = splitSession(started, ended, cfg).slice(0, MAX_LOGGED_DAYS)

    for (const [index, slice] of slices.entries()) {
      const minutes = Math.round(slice.seconds / 60)
      // a long-enough session can still leave a sliver on one side of the boundary;
      // a block of no minutes is not worth a row
      if (minutes < 1) continue

      const startMinute = index === 0 ? Math.round(dayMinuteFor(started, slice.dayKey, cfg)) : 0
      const plan = await this.ensurePlan(slice.dayKey)
      await this.addBlock(plan.id, {
        title: task.title,
        plannedStartMinute: startMinute,
        plannedMinutes: minutes,
        colorHex: task.colorHex,
        completedAt: entry.endedAt,
        sortOrder: startMinute, // start time is the order, as it is for a planned block
      })
    }
  }

  async startTimer(ownerType: OwnerType, ownerId: string): Promise<Entry> {
    const at = nowIso()
    const toStop = this.runningEntries().filter((e) =>
      ownerType === 'block' ? e.ownerType === 'block' : e.ownerType === ownerType && e.ownerId === ownerId,
    )
    // one at a time, so each gets the same end-of-session treatment as a deliberate stop
    for (const e of toStop) await this.finishEntry(e, at)

    const entry = this.newEntry(ownerType, ownerId, { startedAt: at })
    await this.persist('entries', [entry])
    return entry
  }

  async stopTimer(entryId: string): Promise<void> {
    const entry = this.state.entries.find((e) => e.id === entryId)
    if (!entry) return
    await this.finishEntry(entry, nowIso())
  }

  async toggleTimer(ownerType: OwnerType, ownerId: string): Promise<void> {
    const running = this.runningEntries().find((e) => e.ownerType === ownerType && e.ownerId === ownerId)
    if (running) await this.stopTimer(running.id)
    else await this.startTimer(ownerType, ownerId)
  }

  /** For when you forgot to hit start. Stored as an amount in seconds, no session. */
  async addManualSeconds(ownerType: OwnerType, ownerId: string, seconds: number, dayKey?: string): Promise<void> {
    await this.persist('entries', [
      this.newEntry(ownerType, ownerId, { amount: seconds, dayKey: dayKey ?? this.todayKey() }),
    ])
  }

  async logQuantity(taskId: string, amount: number, dayKey?: string): Promise<void> {
    await this.persist('entries', [
      this.newEntry('task', taskId, { amount, dayKey: dayKey ?? this.todayKey() }),
    ])
  }

  async setCheckbox(taskId: string, dayKey: string, checked: boolean): Promise<void> {
    const existing = this.state.entries.filter(
      (e) => !e.deletedAt && !e.isSkip && e.ownerType === 'task' && e.ownerId === taskId && e.dayKey === dayKey,
    )
    if (checked) {
      if (existing.length > 0) return
      await this.persist('entries', [this.newEntry('task', taskId, { amount: 1, dayKey })])
    } else {
      const at = nowIso()
      await this.persist('entries', existing.map((e) => ({ ...e, deletedAt: at, updatedAt: at })))
    }
  }

  async setSkip(taskId: string, dayKey: string, isSkip: boolean): Promise<void> {
    const existing = this.state.entries.filter(
      (e) => !e.deletedAt && e.isSkip && e.ownerType === 'task' && e.ownerId === taskId && e.dayKey === dayKey,
    )
    if (isSkip) {
      if (existing.length > 0) return
      await this.persist('entries', [this.newEntry('task', taskId, { isSkip: true, dayKey })])
    } else {
      const at = nowIso()
      await this.persist('entries', existing.map((e) => ({ ...e, deletedAt: at, updatedAt: at })))
    }
  }

  async updateEntry(id: string, patch: Partial<Entry>): Promise<void> {
    const entry = this.state.entries.find((e) => e.id === id)
    if (!entry) return
    await this.persist('entries', [stamp({ ...entry, ...patch, id: entry.id })])
  }

  async deleteEntry(id: string): Promise<void> {
    await this.updateEntry(id, { deletedAt: nowIso() })
  }

  // ------------------------------------------------------------------- todos

  async createTodo(input: Partial<Todo> & Pick<Todo, 'title'>): Promise<Todo> {
    const minOrder = this.state.todos.reduce((m, t) => Math.min(m, t.sortOrder), 0)
    const todo: Todo = {
      id: uuid(),
      updatedAt: nowIso(),
      deletedAt: null,
      title: input.title,
      notes: input.notes ?? '',
      dueDate: input.dueDate ?? null,
      isFlagged: input.isFlagged ?? false,
      completedAt: null,
      sortOrder: input.sortOrder ?? minOrder - 1,
      linkedTaskId: input.linkedTaskId ?? null,
      phaseId: input.phaseId ?? null,
    }
    await this.persist('todos', [todo])
    return todo
  }

  async updateTodo(id: string, patch: Partial<Todo>): Promise<void> {
    const todo = this.state.todos.find((t) => t.id === id)
    if (!todo) return
    await this.persist('todos', [stamp({ ...todo, ...patch, id: todo.id })])
  }

  /** Checking off a to-do linked to a timer task starts that timer. */
  async toggleTodo(id: string): Promise<void> {
    const todo = this.state.todos.find((t) => t.id === id)
    if (!todo) return
    const completing = todo.completedAt === null
    await this.updateTodo(id, { completedAt: completing ? nowIso() : null })
    if (completing && todo.linkedTaskId) {
      const task = this.state.tasks.find((t) => t.id === todo.linkedTaskId && !t.deletedAt)
      if (task?.kind === 'timer') await this.startTimer('task', task.id)
    }
  }

  async deleteTodo(id: string): Promise<void> {
    await this.updateTodo(id, { deletedAt: nowIso() })
  }

  async reorderTodos(orderedIds: readonly string[]): Promise<void> {
    const rows: Todo[] = []
    orderedIds.forEach((id, i) => {
      const t = this.state.todos.find((x) => x.id === id)
      if (t && t.sortOrder !== i) rows.push(stamp({ ...t, sortOrder: i }))
    })
    await this.persist('todos', rows)
  }

  /**
   * Automatic retention, run on load. Not a button.
   *
   * This only touches to-dos completed longer ago than the retention window, which is
   * correct as a policy and useless as an action: nothing you finished this month
   * qualifies, so a button wired to it appears to do nothing. See clearCompletedTodos.
   */
  async purgeCompletedTodos(now: Date = new Date()): Promise<void> {
    const cutoff = now.getTime() - this.state.settings.todoRetentionDays * 86_400_000
    const stale = this.state.todos.filter(
      (t) => !t.deletedAt && t.completedAt !== null && Date.parse(t.completedAt) < cutoff,
    )
    const at = nowIso()
    await this.persist('todos', stale.map((t) => ({ ...t, deletedAt: at, updatedAt: at })))
  }

  /** What the button does: clear everything completed, whatever its age. */
  async clearCompletedTodos(): Promise<number> {
    const done = this.state.todos.filter((t) => !t.deletedAt && t.completedAt !== null)
    if (done.length === 0) return 0
    const at = nowIso()
    await this.persist('todos', done.map((t) => ({ ...t, deletedAt: at, updatedAt: at })))
    return done.length
  }

  // --------------------------------------------------------------- day plans

  async ensurePlan(dayKey: string): Promise<DayPlan> {
    const existing = this.state.dayPlans.find((p) => !p.deletedAt && p.dayKey === dayKey)
    if (existing) return existing
    const plan: DayPlan = { id: uuid(), updatedAt: nowIso(), deletedAt: null, dayKey, note: '', createdAt: nowIso() }
    await this.persist('dayPlans', [plan])
    return plan
  }

  async addBlock(planId: string, input: Partial<Block> & Pick<Block, 'title'>): Promise<Block> {
    const siblings = this.state.blocks.filter((b) => !b.deletedAt && b.planId === planId)
    const last = [...siblings].sort((a, b) => a.sortOrder - b.sortOrder).at(-1)
    const block: Block = {
      id: uuid(),
      updatedAt: nowIso(),
      deletedAt: null,
      planId,
      title: input.title,
      plannedStartMinute: input.plannedStartMinute ?? (last ? last.plannedStartMinute + last.plannedMinutes : 0),
      plannedMinutes: input.plannedMinutes ?? 60,
      note: input.note ?? '',
      colorHex: input.colorHex ?? '#4F46E5',
      // a block planned by hand starts unticked; one logged from a finished session
      // arrives already done, because it describes work that has happened
      completedAt: input.completedAt ?? null,
      sortOrder: input.sortOrder ?? (last ? last.sortOrder + 1 : 0),
    }
    await this.persist('blocks', [block])
    return block
  }

  async updateBlock(id: string, patch: Partial<Block>): Promise<void> {
    const block = this.state.blocks.find((b) => b.id === id)
    if (!block) return
    await this.persist('blocks', [stamp({ ...block, ...patch, id: block.id })])
  }

  async deleteBlock(id: string): Promise<void> {
    const at = nowIso()
    const block = this.state.blocks.find((b) => b.id === id)
    if (!block) return
    await this.persist('blocks', [{ ...block, deletedAt: at, updatedAt: at }])
    const owned = this.state.entries.filter((e) => e.ownerType === 'block' && e.ownerId === id && !e.deletedAt)
    await this.persist('entries', owned.map((e) => ({ ...e, deletedAt: at, updatedAt: at })))
  }

  async reorderBlocks(orderedIds: readonly string[]): Promise<void> {
    const rows: Block[] = []
    orderedIds.forEach((id, i) => {
      const b = this.state.blocks.find((x) => x.id === id)
      if (b && b.sortOrder !== i) rows.push(stamp({ ...b, sortOrder: i }))
    })
    await this.persist('blocks', rows)
  }

  /** Returns an undo that restores the previous planned starts in one step. */
  async repackFrom(planId: string, fromId: string): Promise<() => Promise<void>> {
    const blocks = this.state.blocks.filter((b) => !b.deletedAt && b.planId === planId)
    const changed = computeRepack(blocks, fromId)
    const before = changed.map((b) => {
      const original = blocks.find((x) => x.id === b.id)!
      return { id: original.id, plannedStartMinute: original.plannedStartMinute }
    })
    await this.persist('blocks', changed.map((b) => stamp(b)))
    return async () => {
      const rows = before
        .map(({ id, plannedStartMinute }) => {
          const cur = this.state.blocks.find((x) => x.id === id)
          return cur ? stamp({ ...cur, plannedStartMinute }) : null
        })
        .filter((r): r is Block => r !== null)
      await this.persist('blocks', rows)
    }
  }

  // ------------------------------------------------------------ daily read

  readFor(dayKey: string): DailyRead | null {
    return this.state.dailyReads.find((r) => !r.deletedAt && r.dayKey === dayKey) ?? null
  }

  /**
   * Everything off the table: picked recently, or already waiting in the buffer.
   *
   * Buffered days matter as much as past ones — fill three days in a single pass without
   * counting them and you get the same paper three mornings running.
   *
   * Tombstoned rows count too, which is the whole point of the skip button. `skipRead`
   * deletes the row, so excluding deleted rows here made a skipped piece instantly
   * eligible again and it came straight back.
   */
  private recentSourceIds(todayKey: string): Set<string> {
    const floor = addDayKey(todayKey, -DEDUPE_DAYS)
    const ids = new Set<string>()
    for (const r of this.state.dailyReads) {
      if (compareDayKeys(r.dayKey, floor) >= 0) ids.add(r.sourceId)
    }
    return ids
  }

  private enabledTopics(): string[] {
    const weights = this.state.settings.readTopics
    const on = Object.entries(weights).filter(([, w]) => w > 0).map(([t]) => t)
    return on.length > 0 ? on : Object.keys(weights)
  }

  /**
   * Fill today and the next two days, if they are not already chosen.
   *
   * Runs whenever we are online. Without a bundled corpus this buffer is the only thing
   * standing between a plane and an empty screen, so it works ahead rather than choosing
   * on demand. Silent on failure: a dry buffer shows an honest empty state, never an
   * error the user cannot act on.
   */
  async fillReadBuffer(depth = 3, now: Date | number = Date.now()): Promise<void> {
    const todayKey = this.todayKey(now)
    const wanted = Array.from({ length: depth }, (_, i) => addDayKey(todayKey, i))
    const missing = wanted.filter((d) => this.readFor(d) === null)
    if (missing.length === 0) return

    const candidates = await fetchCandidates(this.enabledTopics(), todayKey, new Date(now).getTime())
    if (candidates.length === 0) return

    const recent = this.recentSourceIds(todayKey)
    const rows: DailyRead[] = []
    for (const dayKey of missing) {
      const pick = selectPick({
        candidates,
        dayKey,
        topics: this.state.settings.readTopics,
        minutesMax: this.state.settings.readMinutesMax,
        recentSourceIds: recent,
      })
      if (!pick) break
      recent.add(pick.sourceId)
      rows.push({
        id: uuid(),
        updatedAt: nowIso(),
        deletedAt: null,
        dayKey,
        ...pick,
        openedAt: null,
        finishedAt: null,
        skippedAt: null,
        savedAt: null,
        createdAt: nowIso(),
      })
    }
    await this.persist('dailyReads', rows)
  }

  async updateRead(id: string, patch: Partial<DailyRead>): Promise<void> {
    const row = this.state.dailyReads.find((r) => r.id === id)
    if (!row) return
    await this.persist('dailyReads', [stamp({ ...row, ...patch, id: row.id })])
  }

  /** Opening it may start a timer, the way checking off a linked to-do does. */
  async openRead(id: string): Promise<void> {
    await this.updateRead(id, { openedAt: nowIso() })
    const taskId = this.state.settings.readLinkedTaskId
    if (!taskId) return
    const task = this.state.tasks.find((t) => t.id === taskId && !t.deletedAt)
    if (task?.kind === 'timer') await this.startTimer('task', task.id)
  }

  /** Skip draws a replacement for the same day; the skipped item never comes back. */
  async skipRead(id: string): Promise<void> {
    const row = this.state.dailyReads.find((r) => r.id === id)
    if (!row) return
    const at = nowIso()
    await this.persist('dailyReads', [{ ...row, skippedAt: at, deletedAt: at, updatedAt: at }])
    await this.fillReadBuffer(1)
  }

  // ---------------------------------------------------------------- projects

  async createProject(input: Partial<Project> & Pick<Project, 'title'>): Promise<Project> {
    const project: Project = {
      id: uuid(),
      updatedAt: nowIso(),
      deletedAt: null,
      title: input.title,
      group: normalizeGroup(input.group ?? ''),
      notes: input.notes ?? '',
      targetDate: input.targetDate ?? null,
      colorHex: input.colorHex ?? '#4F46E5',
      isArchived: false,
      createdAt: nowIso(),
    }
    await this.persist('projects', [project])
    return project
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<void> {
    const project = this.state.projects.find((p) => p.id === id)
    if (!project) return
    const next = { ...project, ...patch, id: project.id }
    if (patch.group !== undefined) next.group = normalizeGroup(patch.group)
    await this.persist('projects', [stamp(next)])
  }

  async deleteProject(id: string): Promise<void> {
    const at = nowIso()
    const project = this.state.projects.find((p) => p.id === id)
    if (!project) return
    await this.persist('projects', [{ ...project, deletedAt: at, updatedAt: at }])
    const phases = this.state.phases.filter((p) => p.projectId === id && !p.deletedAt)
    await this.persist('phases', phases.map((p) => ({ ...p, deletedAt: at, updatedAt: at })))
  }

  async addPhase(projectId: string, input: Partial<Phase> & Pick<Phase, 'title'>): Promise<Phase> {
    const siblings = this.state.phases.filter((p) => !p.deletedAt && p.projectId === projectId)
    const phase: Phase = {
      id: uuid(),
      updatedAt: nowIso(),
      deletedAt: null,
      projectId,
      title: input.title,
      notes: input.notes ?? '',
      estimatedHours: input.estimatedHours ?? 0,
      completedAt: null,
      sortOrder: input.sortOrder ?? siblings.reduce((m, p) => Math.max(m, p.sortOrder), -1) + 1,
    }
    await this.persist('phases', [phase])
    return phase
  }

  async updatePhase(id: string, patch: Partial<Phase>): Promise<void> {
    const phase = this.state.phases.find((p) => p.id === id)
    if (!phase) return
    await this.persist('phases', [stamp({ ...phase, ...patch, id: phase.id })])
  }

  /** No gating: a phase can be completed before the one before it. */
  async togglePhase(id: string): Promise<void> {
    const phase = this.state.phases.find((p) => p.id === id)
    if (!phase) return
    await this.updatePhase(id, { completedAt: phase.completedAt === null ? nowIso() : null })
  }

  async deletePhase(id: string): Promise<void> {
    await this.updatePhase(id, { deletedAt: nowIso() })
  }

  async reorderPhases(orderedIds: readonly string[]): Promise<void> {
    const rows: Phase[] = []
    orderedIds.forEach((id, i) => {
      const p = this.state.phases.find((x) => x.id === id)
      if (p && p.sortOrder !== i) rows.push(stamp({ ...p, sortOrder: i }))
    })
    await this.persist('phases', rows)
  }
}

export const store = new TallyStore()
