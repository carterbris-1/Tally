// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { store } from '../../src/db/store'
import { clearAll, putMany } from '../../src/db/idb'
import type { Block, Entry, Task } from '../../src/core/types'

/**
 * Store-level behaviour around tasks and timer sessions.
 *
 * The timer had no tests at all before the session-end paths were funnelled through one
 * method, which is exactly the kind of refactor that needs them.
 */

const runningFor = (ownerId: string): Entry | undefined =>
  store.getSnapshot().entries.find((e) => e.ownerId === ownerId && e.startedAt && !e.endedAt)

const entriesFor = (ownerId: string): Entry[] =>
  store.getSnapshot().entries.filter((e) => e.ownerId === ownerId)

beforeEach(async () => {
  await clearAll()
  await store.load()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('logToPlan', () => {
  it('defaults to off for a new task', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer' })
    expect(task.logToPlan).toBe(false)
  })

  it('can be turned on at creation', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer', logToPlan: true })
    expect(task.logToPlan).toBe(true)
  })

  it('reads as off on a task stored before the field existed', async () => {
    // written by an older build, or by another device still running one
    const legacy = {
      id: 'legacy-1',
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      title: 'Old task',
      kind: 'timer',
      goalDirection: 'none',
      goalPeriod: 'day',
      goalValue: null,
      unitLabel: '',
      schedule: { type: 'daily' },
      quickAdds: [],
      colorHex: '#4F46E5',
      symbolName: 'circle',
      sortOrder: 0,
      isArchived: false,
      createdAt: new Date().toISOString(),
    }
    await putMany('tasks', [legacy])
    await store.load()

    const loaded = store.getSnapshot().tasks.find((t) => t.id === 'legacy-1') as Task
    expect(loaded).toBeDefined()
    expect(loaded.logToPlan).toBe(false)
    // and it is genuinely false, not an undefined that merely looks falsy
    expect(Object.hasOwn(loaded, 'logToPlan')).toBe(true)
  })
})

describe('ending a timer session', () => {
  it('ends the previous run when the same task is started again', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer' })
    const first = await store.startTimer('task', task.id)
    const second = await store.startTimer('task', task.id)

    const stored = entriesFor(task.id)
    expect(stored).toHaveLength(2)

    const ended = stored.find((e) => e.id === first.id)!
    expect(ended.endedAt).not.toBeNull()
    // the run ends exactly where the next one begins, no gap invented
    expect(ended.endedAt).toBe(second.startedAt)
    expect(runningFor(task.id)!.id).toBe(second.id)
  })

  it('ends it exactly once, and a later restart does not move the end', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer' })
    const first = await store.startTimer('task', task.id)
    await store.startTimer('task', task.id)

    const endedAt = entriesFor(task.id).find((e) => e.id === first.id)!.endedAt
    await store.startTimer('task', task.id)

    expect(entriesFor(task.id).find((e) => e.id === first.id)!.endedAt).toBe(endedAt)
    expect(entriesFor(task.id)).toHaveLength(3)
    expect(entriesFor(task.id).filter((e) => !e.endedAt)).toHaveLength(1)
  })

  it('leaves an already-stopped session alone', async () => {
    // The clock has to move between the two stops, or a second write lands on the same
    // millisecond and the test passes whether or not anything guards against it.
    // Only Date is faked: freezing the timers as well stalls fake-indexeddb, whose
    // requests never settle, and every await in here hangs.
    vi.useFakeTimers({ now: new Date('2026-09-20T15:00:00.000Z'), toFake: ['Date'] })
    const task = await store.createTask({ title: 'Read', kind: 'timer' })
    const entry = await store.startTimer('task', task.id)
    await store.stopTimer(entry.id)

    const endedAt = entriesFor(task.id)[0]!.endedAt
    expect(endedAt).not.toBeNull()

    vi.setSystemTime(new Date('2026-09-20T15:30:00.000Z'))
    await store.stopTimer(entry.id)
    expect(entriesFor(task.id)[0]!.endedAt).toBe(endedAt)
  })

  it('ignores a stop for an entry that does not exist', async () => {
    await expect(store.stopTimer('nope')).resolves.toBeUndefined()
  })

  it('leaves a different task running', async () => {
    const a = await store.createTask({ title: 'Read', kind: 'timer' })
    const b = await store.createTask({ title: 'Write', kind: 'timer' })
    await store.startTimer('task', a.id)
    await store.startTimer('task', b.id)

    expect(runningFor(a.id)).toBeDefined()
    expect(runningFor(b.id)).toBeDefined()
  })

  it('keeps only one block timer running at a time', async () => {
    // blocks are exclusive with each other, unlike tasks
    const plan = await store.ensurePlan(store.todayKey())
    const one = await store.addBlock(plan.id, { title: 'Deep work' })
    const two = await store.addBlock(plan.id, { title: 'Email' })

    await store.startTimer('block', one.id)
    await store.startTimer('block', two.id)

    expect(runningFor(one.id)).toBeUndefined()
    expect(runningFor(two.id)).toBeDefined()
  })

  it('toggling stops what it started', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer' })
    await store.toggleTimer('task', task.id)
    expect(runningFor(task.id)).toBeDefined()

    await store.toggleTimer('task', task.id)
    expect(runningFor(task.id)).toBeUndefined()
    expect(entriesFor(task.id)).toHaveLength(1)
  })
})

describe('logging a finished session to the day plan', () => {
  const blocksToday = (): Block[] => {
    const plan = store.getSnapshot().dayPlans.find((p) => !p.deletedAt && p.dayKey === store.todayKey())
    if (!plan) return []
    return store.getSnapshot().blocks.filter((b) => !b.deletedAt && b.planId === plan.id)
  }

  /**
   * Run a session of `minutes` on `task`, with the clock under our control.
   *
   * The time is set explicitly rather than passed to `useFakeTimers`, whose `now` is
   * ignored once timers are already faked — so a second call would carry on from where
   * the last session ended instead of starting where it was told to.
   */
  const runFor = async (taskId: string, from: string, minutes: number): Promise<void> => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(from))
    const entry = await store.startTimer('task', taskId)
    vi.setSystemTime(new Date(Date.parse(from) + minutes * 60_000))
    await store.stopTimer(entry.id)
  }

  it('puts a two-minute session on today\'s plan, at the right time, already ticked', async () => {
    const task = await store.createTask({
      title: 'Read', kind: 'timer', logToPlan: true, colorHex: '#EC4899',
    })
    // 14:05 Eastern on a plain September day; the tally day starts at 04:00
    await runFor(task.id, '2026-09-20T18:05:00.000Z', 2)

    const blocks = blocksToday()
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.title).toBe('Read')
    expect(blocks[0]!.plannedStartMinute).toBe(605) // 14:05 is 10h05 past 04:00
    expect(blocks[0]!.plannedMinutes).toBe(2)
    expect(blocks[0]!.colorHex).toBe('#EC4899')
    expect(blocks[0]!.completedAt).not.toBeNull()
  })

  it('writes nothing for a task that did not ask for it', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer' })
    await runFor(task.id, '2026-09-20T18:05:00.000Z', 30)
    expect(blocksToday()).toHaveLength(0)
    // and no empty plan is conjured up either
    expect(store.getSnapshot().dayPlans).toHaveLength(0)
  })

  it('writes one block per run, so three runs leave three blocks', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer', logToPlan: true })
    await runFor(task.id, '2026-09-20T18:00:00.000Z', 10)
    await runFor(task.id, '2026-09-20T19:00:00.000Z', 10)
    await runFor(task.id, '2026-09-20T20:00:00.000Z', 10)

    const starts = blocksToday().map((b) => b.plannedStartMinute).sort((a, b) => a - b)
    expect(starts).toEqual([600, 660, 720])
  })

  it('logs the run that a restart cut short, not just the deliberate stop', async () => {
    // the path that used to set endedAt inline and would have been missed entirely
    const task = await store.createTask({ title: 'Read', kind: 'timer', logToPlan: true })
    vi.useFakeTimers({ now: new Date('2026-09-20T18:00:00.000Z'), toFake: ['Date'] })
    await store.startTimer('task', task.id)
    vi.setSystemTime(new Date('2026-09-20T18:20:00.000Z'))
    await store.startTimer('task', task.id) // restart without stopping

    const blocks = blocksToday()
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.plannedMinutes).toBe(20)
  })

  it('never logs a block timer, which would breed copies of itself', async () => {
    // the clock is faked before anything is created: `blocksToday` resolves today from
    // whatever Date says, so a plan made under the real clock and read back under a fake
    // one looks at two different days. That is a test that passes only on the day it
    // was written, which is exactly what happened here.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-20T18:00:00.000Z'))
    const plan = await store.ensurePlan(store.todayKey())
    const block = await store.addBlock(plan.id, { title: 'Deep work' })
    const entry = await store.startTimer('block', block.id)
    vi.setSystemTime(new Date('2026-09-20T18:30:00.000Z'))
    await store.stopTimer(entry.id)

    expect(blocksToday()).toHaveLength(1) // the original, and nothing new
  })

  it('writes nothing for time added by hand, which has no start or end', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer', logToPlan: true })
    await store.addManualSeconds('task', task.id, 1800)
    expect(blocksToday()).toHaveLength(0)
  })

  it('lands in the right slot on the day the clocks go back', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer', logToPlan: true })
    // 03:00 EST on 2026-11-01, inside the 25-hour day that began 04:00 on 10-31.
    // Elapsed time since that start is 24h; the wall clock says 23.
    await runFor(task.id, '2026-11-01T08:00:00.000Z', 15)

    const plan = store.getSnapshot().dayPlans.find((p) => !p.deletedAt)!
    expect(plan.dayKey).toBe('2026-10-31')
    const blocks = store.getSnapshot().blocks.filter((b) => b.planId === plan.id)
    expect(blocks[0]!.plannedStartMinute).toBe(1380) // not 1440, which is off the day
  })
})

describe('sessions too short, and sessions that cross the day start', () => {
  const allBlocks = (): Block[] => store.getSnapshot().blocks.filter((b) => !b.deletedAt)

  const blocksOn = (dayKey: string): Block[] => {
    const plan = store.getSnapshot().dayPlans.find((p) => !p.deletedAt && p.dayKey === dayKey)
    return plan ? allBlocks().filter((b) => b.planId === plan.id) : []
  }

  const runSeconds = async (taskId: string, from: string, seconds: number): Promise<void> => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(from))
    const entry = await store.startTimer('task', taskId)
    vi.setSystemTime(new Date(Date.parse(from) + seconds * 1000))
    await store.stopTimer(entry.id)
  }

  const flagged = () => store.createTask({ title: 'Read', kind: 'timer', logToPlan: true })

  it('writes nothing when play is tapped and stopped straight away', async () => {
    const task = await flagged()
    await runSeconds(task.id, '2026-09-20T18:00:00.000Z', 0)
    expect(allBlocks()).toHaveLength(0)
    expect(store.getSnapshot().dayPlans).toHaveLength(0)
  })

  it('discards a session just under the minute and keeps one just over', async () => {
    const task = await flagged()
    await runSeconds(task.id, '2026-09-20T18:00:00.000Z', 59)
    expect(allBlocks()).toHaveLength(0)

    await runSeconds(task.id, '2026-09-20T19:00:00.000Z', 61)
    expect(allBlocks()).toHaveLength(1)
    expect(allBlocks()[0]!.plannedMinutes).toBe(1)
  })

  it('splits a session that runs through 04:00 across two days', async () => {
    const task = await flagged()
    // 03:30 to 04:30 Eastern on 2026-09-21: half belongs to the day that began
    // 04:00 on the 20th, half to the one starting now
    await runSeconds(task.id, '2026-09-21T07:30:00.000Z', 60 * 60)

    const before = blocksOn('2026-09-20')
    const after = blocksOn('2026-09-21')
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(1)
    expect(before[0]!.plannedMinutes).toBe(30)
    expect(after[0]!.plannedMinutes).toBe(30)
    // the first ends exactly at the day boundary, the second starts at it
    expect(before[0]!.plannedStartMinute).toBe(1410)
    expect(after[0]!.plannedStartMinute).toBe(0)
  })

  it('creates the second day\'s plan when it did not exist', async () => {
    const task = await flagged()
    expect(store.getSnapshot().dayPlans).toHaveLength(0)
    await runSeconds(task.id, '2026-09-21T07:30:00.000Z', 60 * 60)
    expect(store.getSnapshot().dayPlans.map((p) => p.dayKey).sort()).toEqual([
      '2026-09-20', '2026-09-21',
    ])
  })

  it('drops the sliver when a session barely clears the boundary', async () => {
    const task = await flagged()
    // 03:59:50 to 04:01:00: 10 seconds one side, 60 the other
    await runSeconds(task.id, '2026-09-21T07:59:50.000Z', 70)
    expect(blocksOn('2026-09-20')).toHaveLength(0) // the 10-second sliver
    expect(blocksOn('2026-09-21')).toHaveLength(1)
    expect(blocksOn('2026-09-21')[0]!.plannedMinutes).toBe(1)
  })

  it('caps a timer left running for days at two blocks', async () => {
    const task = await flagged()
    await runSeconds(task.id, '2026-09-20T18:00:00.000Z', 4 * 24 * 60 * 60)
    expect(allBlocks()).toHaveLength(2)
    expect(store.getSnapshot().dayPlans).toHaveLength(2)
  })

  it('still writes one block for a session well inside a single day', async () => {
    const task = await flagged()
    await runSeconds(task.id, '2026-09-20T18:00:00.000Z', 45 * 60)
    expect(allBlocks()).toHaveLength(1)
    expect(allBlocks()[0]!.plannedMinutes).toBe(45)
  })
})
