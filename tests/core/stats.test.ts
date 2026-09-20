import { describe, expect, it } from 'vitest'
import { earliestDay, rangeFor, startOfMonth, statsForTask, timeOfDayBuckets } from '../../src/core/stats'
import type { Entry, Schedule, Task } from '../../src/core/types'
import { NY, wallClock } from '../helpers'

const MON = 1
const HOUR = 3600

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

const session = (dayKey: string, startLocal: string, minutes: number): Entry => ({
  ...day(dayKey, 0),
  id: `${dayKey}-${startLocal}`,
  startedAt: wallClock(startLocal).toISOString(),
  endedAt: new Date(wallClock(startLocal).getTime() + minutes * 60_000).toISOString(),
})

type TaskShape = Pick<Task, 'kind' | 'goalDirection' | 'goalPeriod' | 'goalValue' | 'schedule'>

const read30: TaskShape = {
  kind: 'timer',
  goalDirection: 'atLeast',
  goalPeriod: 'day',
  goalValue: 30 * 60,
  schedule: { type: 'daily' },
}

const NOW = wallClock('2026-09-30T12:00')

describe('rangeFor', () => {
  it('picks the right span for each window', () => {
    expect(rangeFor('month', '2026-09-12', MON, '2026-01-01')).toEqual({ from: '2026-09-01', to: '2026-09-12' })
    expect(rangeFor('week', '2026-09-12', MON, '2026-01-01')).toEqual({ from: '2026-09-07', to: '2026-09-12' })
    expect(rangeFor('all', '2026-09-12', MON, '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-09-12' })
  })

  it('never starts an all-time range after today', () => {
    expect(rangeFor('all', '2026-09-12', MON, '2027-01-01').from).toBe('2026-09-12')
  })

  it('finds the month start', () => {
    expect(startOfMonth('2026-09-12')).toBe('2026-09-01')
  })
})

describe('statsForTask — the number actually wanted', () => {
  it('counts the days the goal was met, not the days touched', () => {
    const entries = [
      day('2026-09-01', 40 * 60), // met
      day('2026-09-02', 10 * 60), // touched, not met
      day('2026-09-03', 30 * 60), // met exactly
      day('2026-09-04', 45 * 60), // met
    ]
    const stats = statsForTask(read30, entries, NY, MON, { from: '2026-09-01', to: '2026-09-04' }, NOW)
    expect(stats.completePeriods).toBe(3) // "read 3 times"
    expect(stats.activeDays).toBe(4) // opened the book 4 times
    expect(stats.total).toBe(125 * 60)
    expect(stats.periodLabel).toBe('days')
  })

  it('computes a completion rate over scheduled days only', () => {
    const schedule: Schedule = { type: 'weekdays', days: [1, 3, 5] }
    const task = { ...read30, schedule }
    // 2026-09-07 Mon, 09 Wed, 11 Fri are the scheduled days that week
    const entries = [day('2026-09-07', 40 * 60), day('2026-09-09', 40 * 60), day('2026-09-08', 40 * 60)]
    const stats = statsForTask(task, entries, NY, MON, { from: '2026-09-07', to: '2026-09-13' }, NOW)
    expect(stats.scheduledPeriods).toBe(3)
    expect(stats.completePeriods).toBe(2) // Tuesday's session does not count
    expect(stats.rate).toBeCloseTo(2 / 3)
  })

  it('excludes skipped days from the denominator', () => {
    const entries = [day('2026-09-01', 40 * 60), day('2026-09-02', 0, true)]
    const stats = statsForTask(read30, entries, NY, MON, { from: '2026-09-01', to: '2026-09-02' }, NOW)
    expect(stats.scheduledPeriods).toBe(1)
    expect(stats.rate).toBe(1)
  })

  it('reports zero rather than dividing by zero', () => {
    const stats = statsForTask(read30, [], NY, MON, { from: '2026-09-01', to: '2026-09-01' }, NOW)
    expect(stats.rate).toBe(0)
    expect(stats.completePeriods).toBe(0)
  })

  it('counts weeks, not days, for a weekly task', () => {
    const weekly: TaskShape = { ...read30, goalPeriod: 'week', goalValue: 5 * HOUR }
    const entries = [
      day('2026-09-07', 5 * HOUR), // week of the 7th: met
      day('2026-09-14', 1 * HOUR), // week of the 14th: not met
      day('2026-09-21', 6 * HOUR), // met
    ]
    const stats = statsForTask(weekly, entries, NY, MON, { from: '2026-09-07', to: '2026-09-27' }, NOW)
    expect(stats.periodLabel).toBe('weeks')
    expect(stats.scheduledPeriods).toBe(3)
    expect(stats.completePeriods).toBe(2)
  })
})

describe('timeOfDayBuckets', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' }

  it('attributes a session to the hour it started', () => {
    const buckets = timeOfDayBuckets([session('2026-09-10', '2026-09-10T21:30', 30)], NY, range, NOW)
    expect(buckets[21]).toBe(30 * 60)
    expect(buckets[22]).toBe(0)
  })

  it('puts a long session in its start hour only', () => {
    // three hours from 21:30 would otherwise smear across 21, 22 and 23
    const buckets = timeOfDayBuckets([session('2026-09-10', '2026-09-10T21:30', 180)], NY, range, NOW)
    expect(buckets[21]).toBe(180 * 60)
    expect(buckets[22]).toBe(0)
    expect(buckets[23]).toBe(0)
  })

  it('keeps a session that crosses the day boundary in its start hour', () => {
    const buckets = timeOfDayBuckets([session('2026-09-10', '2026-09-11T03:45', 90)], NY, range, NOW)
    expect(buckets[3]).toBe(90 * 60)
    expect(buckets[5]).toBe(0)
  })

  it('ignores manual entries, skips and tombstones', () => {
    const entries = [
      day('2026-09-10', 45 * 60), // manual, no session
      { ...session('2026-09-10', '2026-09-10T09:00', 30), isSkip: true },
      { ...session('2026-09-10', '2026-09-10T10:00', 30), deletedAt: '2026-09-11T00:00:00.000Z' },
    ]
    expect(timeOfDayBuckets(entries, NY, range, NOW).every((b) => b === 0)).toBe(true)
  })

  it('ignores sessions outside the window', () => {
    const buckets = timeOfDayBuckets([session('2026-08-10', '2026-08-10T09:00', 30)], NY, range, NOW)
    expect(buckets[9]).toBe(0)
  })
})

describe('earliestDay', () => {
  it('finds the first day touched, falling back when there is nothing', () => {
    expect(earliestDay([day('2026-09-10', 1), day('2026-03-02', 1)], '2026-12-01')).toBe('2026-03-02')
    expect(earliestDay([], '2026-12-01')).toBe('2026-12-01')
  })
})
