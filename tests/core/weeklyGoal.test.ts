import { describe, expect, it } from 'vitest'
import { computeWeeklyStreaks, evaluateWeek, weekTotal } from '../../src/core/streak'
import type { Entry, Schedule, Task } from '../../src/core/types'
import { NY, wallClock } from '../helpers'

const MON = 1
const MIN = 60

/** A day's total as a manual entry, so these tests are about weeks, not timers. */
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

// "10 hours of deep work this week"
const deepWork = (schedule: Schedule = { type: 'daily' }): TaskShape => ({
  kind: 'timer',
  goalDirection: 'atLeast',
  goalValue: 10 * 60 * MIN,
  schedule,
  createdAt: '2026-08-31T12:00:00.000Z', // a Monday
})

// the week of 2026-09-07..13; Friday lunchtime, week still running
const FRIDAY = wallClock('2026-09-11T12:00')
// after the week has closed
const NEXT_WEEK = wallClock('2026-09-15T12:00')

describe('evaluateWeek', () => {
  const goal = { direction: 'atLeast' as const, value: 600 }
  const limit = { direction: 'atMost' as const, value: 600 }

  it('completes a weekly target the moment it is met, mid-week', () => {
    expect(evaluateWeek({ goal, total: 600, isSkip: false, scheduled: true, weekEnded: false })).toBe('complete')
  })

  it('leaves a short week unresolved until it closes', () => {
    expect(evaluateWeek({ goal, total: 400, isSkip: false, scheduled: true, weekEnded: false })).toBe('unresolved')
    expect(evaluateWeek({ goal, total: 400, isSkip: false, scheduled: true, weekEnded: true })).toBe('incomplete')
  })

  it('never calls a weekly limit complete mid-week, but fails it immediately', () => {
    expect(evaluateWeek({ goal: limit, total: 100, isSkip: false, scheduled: true, weekEnded: false })).toBe('unresolved')
    expect(evaluateWeek({ goal: limit, total: 100, isSkip: false, scheduled: true, weekEnded: true })).toBe('complete')
    expect(evaluateWeek({ goal: limit, total: 601, isSkip: false, scheduled: true, weekEnded: false })).toBe('incomplete')
  })
})

describe('weekTotal', () => {
  it('sums the days of the week, not a timestamp range', () => {
    const entries = [
      day('2026-09-07', 3 * 60 * MIN),
      day('2026-09-09', 4 * 60 * MIN),
      day('2026-09-13', 1 * 60 * MIN), // Sunday, last day of the week
      day('2026-09-14', 9 * 60 * MIN), // next week, must not count
    ]
    expect(weekTotal(entries, 'timer', '2026-09-07', NY, FRIDAY)).toBe(8 * 60 * MIN)
  })
})

describe('computeWeeklyStreaks', () => {
  it('completes at the target and not a minute sooner', () => {
    const short = [day('2026-09-07', 9 * 60 * MIN), day('2026-09-08', 59 * MIN)]
    expect(computeWeeklyStreaks(deepWork(), short, NY, MON, FRIDAY).statuses.get('2026-09-07')).toBe('unresolved')

    const met = [...short, day('2026-09-09', 1 * MIN)]
    expect(computeWeeklyStreaks(deepWork(), met, NY, MON, FRIDAY).statuses.get('2026-09-07')).toBe('complete')
  })

  it('counts consecutive weeks', () => {
    const full = (weekStart: string): Entry[] => [day(weekStart, 10 * 60 * MIN)]
    const entries = [...full('2026-08-31'), ...full('2026-09-07')]
    const r = computeWeeklyStreaks(deepWork(), entries, NY, MON, FRIDAY)
    expect(r.current).toBe(2)
    expect(r.totalCompletions).toBe(2)
  })

  it('breaks the streak on a missed week', () => {
    const entries = [day('2026-08-24', 10 * 60 * MIN), day('2026-09-07', 10 * 60 * MIN)]
    const task = { ...deepWork(), createdAt: '2026-08-24T12:00:00.000Z' }
    const r = computeWeeklyStreaks(task, entries, NY, MON, FRIDAY)
    expect(r.statuses.get('2026-08-31')).toBe('incomplete') // the empty week between
    expect(r.current).toBe(1)
    expect(r.longest).toBe(1)
  })

  it('does not break on a week that is merely still running', () => {
    const entries = [day('2026-08-31', 10 * 60 * MIN), day('2026-09-07', 2 * 60 * MIN)]
    const r = computeWeeklyStreaks(deepWork(), entries, NY, MON, FRIDAY)
    expect(r.statuses.get('2026-09-07')).toBe('unresolved')
    expect(r.current).toBe(1)
  })

  it('resolves the week once it closes', () => {
    const entries = [day('2026-09-07', 2 * 60 * MIN)]
    const r = computeWeeklyStreaks(deepWork(), entries, NY, MON, NEXT_WEEK)
    expect(r.statuses.get('2026-09-07')).toBe('incomplete')
  })

  it('skipping one day does not excuse the week', () => {
    const entries = [day('2026-09-07', 0, true)]
    const r = computeWeeklyStreaks(deepWork(), entries, NY, MON, NEXT_WEEK)
    expect(r.statuses.get('2026-09-07')).toBe('incomplete')
  })

  it('treats a week as neutral only when every scheduled day is skipped', () => {
    const schedule: Schedule = { type: 'weekdays', days: [1, 3] } // Mon and Wed
    const entries = [day('2026-09-07', 0, true), day('2026-09-09', 0, true)]
    const r = computeWeeklyStreaks(deepWork(schedule), entries, NY, MON, NEXT_WEEK)
    expect(r.statuses.get('2026-09-07')).toBe('neutral')
  })

  it('handles a weekly limit', () => {
    const tv: TaskShape = {
      kind: 'timer',
      goalDirection: 'atMost',
      goalValue: 5 * 60 * MIN, // 5h of TV a week
      schedule: { type: 'daily' },
      createdAt: '2026-09-07T12:00:00.000Z',
    }
    const under = [day('2026-09-07', 2 * 60 * MIN)]
    expect(computeWeeklyStreaks(tv, under, NY, MON, FRIDAY).statuses.get('2026-09-07')).toBe('unresolved')

    const over = [...under, day('2026-09-08', 4 * 60 * MIN)]
    expect(computeWeeklyStreaks(tv, over, NY, MON, FRIDAY).statuses.get('2026-09-07')).toBe('incomplete')
  })
})
