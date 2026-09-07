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

import { dayKeyFor, type DayConfig } from '../core/dayKey'
import { repack as computeRepack } from '../core/repack'
import { DEFAULT_SETTINGS, type Block, type DayPlan, type Entry, type OwnerType, type Phase, type Project, type Settings, type Task, type Todo } from '../core/types'
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
  settings: DEFAULT_SETTINGS,
}

const nowIso = (): string => new Date().toISOString()
const uuid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`

const stamp = <T extends { updatedAt: string }>(row: T): T => ({ ...row, updatedAt: nowIso() })

type Collection = 'tasks' | 'entries' | 'todos' | 'dayPlans' | 'blocks' | 'projects' | 'phases'

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

  todayKey(now: Date | number = Date.now()): string {
    return dayKeyFor(now, this.dayConfig)
  }

  async load(): Promise<void> {
    const [tasks, entries, todos, dayPlans, blocks, projects, phases, settings] = await Promise.all([
      getAll<Task>('tasks'),
      getAll<Entry>('entries'),
      getAll<Todo>('todos'),
      getAll<DayPlan>('dayPlans'),
      getAll<Block>('blocks'),
      getAll<Project>('projects'),
      getAll<Phase>('phases'),
      getMeta<Settings>('settings'),
    ])
    this.emit({
      ready: true,
      tasks,
      entries,
      todos,
      dayPlans,
      blocks,
      projects,
      phases,
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
      goalValue: input.goalValue ?? null,
      unitLabel: input.unitLabel ?? '',
      schedule: input.schedule ?? { type: 'daily' },
      quickAdds: input.quickAdds ?? [],
      colorHex: input.colorHex ?? '#4F46E5',
      symbolName: input.symbolName ?? 'circle',
      sortOrder: input.sortOrder ?? maxOrder + 1,
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
  async startTimer(ownerType: OwnerType, ownerId: string): Promise<Entry> {
    const at = nowIso()
    const toStop = this.runningEntries().filter((e) =>
      ownerType === 'block' ? e.ownerType === 'block' : e.ownerType === ownerType && e.ownerId === ownerId,
    )
    if (toStop.length > 0) {
      await this.persist('entries', toStop.map((e) => ({ ...e, endedAt: at, updatedAt: at })))
    }
    const entry = this.newEntry(ownerType, ownerId, { startedAt: at })
    await this.persist('entries', [entry])
    return entry
  }

  async stopTimer(entryId: string): Promise<void> {
    const entry = this.state.entries.find((e) => e.id === entryId)
    if (!entry || entry.endedAt) return
    await this.persist('entries', [stamp({ ...entry, endedAt: nowIso() })])
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

  /** Completed to-dos are kept for a while, then tombstoned. */
  async purgeCompletedTodos(now: Date = new Date()): Promise<void> {
    const cutoff = now.getTime() - this.state.settings.todoRetentionDays * 86_400_000
    const stale = this.state.todos.filter(
      (t) => !t.deletedAt && t.completedAt !== null && Date.parse(t.completedAt) < cutoff,
    )
    const at = nowIso()
    await this.persist('todos', stale.map((t) => ({ ...t, deletedAt: at, updatedAt: at })))
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
      completedAt: null,
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

  // ---------------------------------------------------------------- projects

  async createProject(input: Partial<Project> & Pick<Project, 'title'>): Promise<Project> {
    const project: Project = {
      id: uuid(),
      updatedAt: nowIso(),
      deletedAt: null,
      title: input.title,
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
    await this.persist('projects', [stamp({ ...project, ...patch, id: project.id })])
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
