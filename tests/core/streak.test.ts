import { describe, expect, it } from 'vitest'
import { computeStreaks, effectiveGoal, evaluateDay, limitStatusToday, skipsUsedInMonth } from '../../src/core/streak'
import type { Entry, Schedule, Task } from '../../src/core/types'
import { NY, wallClock } from '../helpers'

const MIN = 60

/** A day total, expressed as a manual entry so the tests are about streaks, not timers. */
const day = (dayKey: string, amount: number, isSkip = false): Entry => ({
  id: `${dayKey}-${amount}-${isSkip}`,
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
  ownerType: 'task',
  ownerId: 'task-1',
  dayKey,
  startedAt: null,
  endedAt: null,
  amount,
  note: '',
  isSkip,
  createdAt: '2026-09-01T00:00:00.000Z',
})

type TaskShape = Pick<Task, 'kind' | 'goalDirection' | 'goalValue' | 'schedule' | 'createdAt'>

const readTask = (schedule: Schedule = { type: 'daily' }): TaskShape => ({
  kind: 'timer',
  goalDirection: 'atLeast',
  goalValue: 30 * MIN, // 30 minutes
  schedule,
  createdAt: '2026-08-25T12:00:00.000Z',
})

const tvTask: TaskShape = {
  kind: 'timer',
  goalDirection: 'atMost',
  goalValue: 120 * MIN, // 2 hours
  schedule: { type: 'daily' },
  createdAt: '2026-08-25T12:00:00.000Z',
}

const NOON = wallClock('2026-09-03T12:00') // mid-afternoon of 2026-09-03, day not ended

describe('evaluateDay', () => {
  const atLeast = { direction: 'atLeast' as const, value: 30 }
  const atMost = { direction: 'atMost' as const, value: 120 }

  it('completes a target as soon as it is met, even mid-day', () => {
    expect(evaluateDay({ goal: atLeast, total: 30, isSkip: false, scheduled: true, dayEnded: false })).toBe('complete')
  })

  it('leaves an unmet target unresolved until the day ends', () => {
    expect(evaluateDay({ goal: atLeast, total: 10, isSkip: false, scheduled: true, dayEnded: false })).toBe('unresolved')
    expect(evaluateDay({ goal: atLeast, total: 10, isSkip: false, scheduled: true, dayEnded: true })).toBe('incomplete')
  })

  it('never calls a limit complete while the day is still running', () => {
    expect(evaluateDay({ goal: atMost, total: 10, isSkip: false, scheduled: true, dayEnded: false })).toBe('unresolved')
    expect(evaluateDay({ goal: atMost, total: 10, isSkip: false, scheduled: true, dayEnded: true })).toBe('complete')
  })

  it('fails a limit the moment it is exceeded — over is over', () => {
    expect(evaluateDay({ goal: atMost, total: 121, isSkip: false, scheduled: true, dayEnded: false })).toBe('incomplete')
  })

  it('treats skipped and unscheduled days as neutral', () => {
    expect(evaluateDay({ goal: atLeast, total: 0, isSkip: true, scheduled: true, dayEnded: true })).toBe('neutral')
    expect(evaluateDay({ goal: atLeast, total: 0, isSkip: false, scheduled: false, dayEnded: true })).toBe('neutral')
  })
})

describe('effectiveGoal', () => {
  it('makes a checkbox an implicit atLeast 1', () => {
    expect(effectiveGoal('checkbox', 'none', null)).toEqual({ direction: 'atLeast', value: 1 })
  })

  it('falls back to plain tracking when there is no goal value', () => {
    expect(effectiveGoal('quantity', 'atLeast', null)).toEqual({ direction: 'none', value: 0 })
  })
})

describe('computeStreaks', () => {
  it('counts back from today and stops at the first failed day', () => {
    const entries = [
      day('2026-08-29', 40 * MIN),
      day('2026-08-30', 40 * MIN),
      day('2026-08-31', 40 * MIN),
      day('2026-09-01', 10 * MIN), // short, and the day has ended
      day('2026-09-02', 40 * MIN),
      day('2026-09-03', 40 * MIN), // today, already met
    ]
    const r = computeStreaks(readTask(), entries, NY, NOON)
    expect(r.current).toBe(2)
    expect(r.longest).toBe(3)
    expect(r.totalCompletions).toBe(5)
  })

  it('does not break the streak when today is merely unfinished', () => {
    const entries = [day('2026-09-01', 40 * MIN), day('2026-09-02', 40 * MIN), day('2026-09-03', 10 * MIN)]
    const r = computeStreaks(readTask(), entries, NY, NOON)
    expect(r.statuses.get('2026-09-03')).toBe('unresolved')
    expect(r.current).toBe(2)
  })

  it('excludes today for a limit task until the day ends', () => {
    const entries = [day('2026-09-01', 60 * MIN), day('2026-09-02', 60 * MIN), day('2026-09-03', 60 * MIN)]
    const r = computeStreaks(tvTask, entries, NY, NOON)
    expect(r.statuses.get('2026-09-03')).toBe('unresolved')
    // today is excluded, so the streak ends at 2026-09-02 and runs back to creation
    expect(r.current).toBe(9)
  })

  it('counts an untouched day as success for a limit task', () => {
    // you cannot exceed a limit you never touched. Requiring the user to log
    // "watched 0 minutes of TV" to keep a streak alive would be absurd, so absence
    // of data is success — which means limit streaks accrue passively.
    const r = computeStreaks(tvTask, [], NY, NOON)
    expect(r.statuses.get('2026-09-01')).toBe('complete')
    expect(r.current).toBe(9) // 2026-08-25 (created) through 2026-09-02
  })

  it('does not backdate a limit streak before the task existed', () => {
    const fresh = { ...tvTask, createdAt: '2026-09-02T12:00:00.000Z' }
    expect(computeStreaks(fresh, [], NY, NOON).current).toBe(1)
  })

  it('still requires data for a target task — silence is not success there', () => {
    const r = computeStreaks(readTask(), [], NY, NOON)
    expect(r.statuses.get('2026-09-01')).toBe('incomplete')
    expect(r.current).toBe(0)
  })

  it('breaks a limit streak immediately when the limit is blown', () => {
    const entries = [day('2026-09-01', 60 * MIN), day('2026-09-02', 60 * MIN), day('2026-09-03', 180 * MIN)]
    const r = computeStreaks(tvTask, entries, NY, NOON)
    expect(r.statuses.get('2026-09-03')).toBe('incomplete')
    expect(r.current).toBe(0)
  })

  it('treats a skipped day as neutral and keeps the streak running through it', () => {
    const entries = [
      day('2026-09-01', 40 * MIN),
      day('2026-09-02', 0, true), // sick
      day('2026-09-03', 40 * MIN),
    ]
    const r = computeStreaks(readTask(), entries, NY, NOON)
    expect(r.statuses.get('2026-09-02')).toBe('neutral')
    expect(r.current).toBe(2)
  })

  it('steps over unscheduled days on a weekday schedule', () => {
    // 2026-09-03 is a Thursday; the task runs Mon/Wed/Fri
    const schedule: Schedule = { type: 'weekdays', days: [1, 3, 5] }
    const entries = [day('2026-08-28', 40 * MIN), day('2026-08-31', 40 * MIN), day('2026-09-02', 40 * MIN)]
    const r = computeStreaks(readTask(schedule), entries, NY, NOON)
    expect(r.statuses.get('2026-09-03')).toBe('neutral')
    expect(r.current).toBe(3)
  })

  it('recomputes rather than incrementing — editing a past day changes the answer', () => {
    const base = [day('2026-09-01', 40 * MIN), day('2026-09-02', 40 * MIN), day('2026-09-03', 40 * MIN)]
    expect(computeStreaks(readTask(), base, NY, NOON).current).toBe(3)

    const edited = base.map((e) => (e.dayKey === '2026-09-02' ? { ...e, amount: 5 * MIN } : e))
    expect(computeStreaks(readTask(), edited, NY, NOON).current).toBe(1)
  })

  it('handles a task with no entries at all', () => {
    const r = computeStreaks(readTask(), [], NY, NOON)
    expect(r).toMatchObject({ current: 0, longest: 0, totalCompletions: 0 })
  })
})

describe('limits and skips', () => {
  it('reads a limit day as on track or exceeded, never complete', () => {
    const goal = { direction: 'atMost' as const, value: 120 }
    expect(limitStatusToday(60, goal)).toBe('onTrack')
    expect(limitStatusToday(121, goal)).toBe('exceeded')
  })

  it('counts skips per calendar month, not per rolling window', () => {
    const entries = [day('2026-09-01', 0, true), day('2026-09-20', 0, true), day('2026-08-31', 0, true)]
    expect(skipsUsedInMonth(entries, '2026-09-15')).toBe(2)
    expect(skipsUsedInMonth(entries, '2026-08-15')).toBe(1)
  })
})
