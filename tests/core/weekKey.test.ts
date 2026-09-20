import { describe, expect, it } from 'vitest'
import {
  addWeekKey,
  daysInWeek,
  daysLeftInWeek,
  eachWeekKey,
  isWeekEnded,
  lastDayOfWeek,
  weekKeyFor,
} from '../../src/core/weekKey'
import { weekdayOf } from '../../src/core/dayKey'
import { NY, wallClock } from '../helpers'

const MON = 1
const SUN = 0

describe('weekKeyFor', () => {
  it('walks back to the start of the week', () => {
    // 2026-09-12 is a Saturday
    expect(weekdayOf('2026-09-12')).toBe(6)
    expect(weekKeyFor('2026-09-12', MON)).toBe('2026-09-07') // Monday
    expect(weekKeyFor('2026-09-12', SUN)).toBe('2026-09-06') // Sunday
  })

  it('is a fixed point on the week start itself', () => {
    expect(weekKeyFor('2026-09-07', MON)).toBe('2026-09-07')
    expect(weekKeyFor('2026-09-06', SUN)).toBe('2026-09-06')
  })

  it('puts Sunday in the previous week when weeks start Monday', () => {
    expect(weekdayOf('2026-09-13')).toBe(0)
    expect(weekKeyFor('2026-09-13', MON)).toBe('2026-09-07')
    expect(weekKeyFor('2026-09-13', SUN)).toBe('2026-09-13')
  })

  it('crosses a year boundary without special casing', () => {
    // 2027-01-01 is a Friday
    expect(weekKeyFor('2027-01-01', MON)).toBe('2026-12-28')
    expect(weekKeyFor('2027-01-01', SUN)).toBe('2026-12-27')
  })

  it('assigns every day of a week to the same key', () => {
    const keys = daysInWeek('2026-09-07').map((d) => weekKeyFor(d, MON))
    expect(new Set(keys)).toEqual(new Set(['2026-09-07']))
  })
})

describe('daysInWeek', () => {
  it('is always seven days, including across a DST transition', () => {
    expect(daysInWeek('2026-09-07')).toHaveLength(7)
    // the spring-forward week: 2026-03-08 is the 23-hour day
    const spring = daysInWeek(weekKeyFor('2026-03-08', MON))
    expect(spring).toHaveLength(7)
    expect(spring).toContain('2026-03-08')
    // and the fall-back week
    const fall = daysInWeek(weekKeyFor('2026-11-01', MON))
    expect(fall).toHaveLength(7)
    expect(fall).toContain('2026-11-01')
  })

  it('starts at the week key and ends at lastDayOfWeek', () => {
    const days = daysInWeek('2026-09-07')
    expect(days[0]).toBe('2026-09-07')
    expect(days[6]).toBe('2026-09-13')
    expect(lastDayOfWeek('2026-09-07')).toBe('2026-09-13')
  })
})

describe('isWeekEnded', () => {
  it('is not over until the last day is over', () => {
    // the week 2026-09-07..13 ends at 04:00 on the 14th
    expect(isWeekEnded('2026-09-07', NY, wallClock('2026-09-13T23:00'))).toBe(false)
    expect(isWeekEnded('2026-09-07', NY, wallClock('2026-09-14T03:59'))).toBe(false)
    expect(isWeekEnded('2026-09-07', NY, wallClock('2026-09-14T04:00'))).toBe(true)
  })

  it('respects the 04:00 boundary on a DST week too', () => {
    const spring = weekKeyFor('2026-03-08', MON) // 2026-03-02
    expect(isWeekEnded(spring, NY, wallClock('2026-03-09T03:00'))).toBe(false)
    expect(isWeekEnded(spring, NY, wallClock('2026-03-09T05:00'))).toBe(true)
  })
})

describe('week arithmetic', () => {
  it('adds and subtracts whole weeks', () => {
    expect(addWeekKey('2026-09-07', 1)).toBe('2026-09-14')
    expect(addWeekKey('2026-09-07', -1)).toBe('2026-08-31')
    expect(addWeekKey('2026-09-07', 0)).toBe('2026-09-07')
  })

  it('counts days left including today', () => {
    expect(daysLeftInWeek('2026-09-07', '2026-09-07')).toBe(7)
    expect(daysLeftInWeek('2026-09-07', '2026-09-11')).toBe(3)
    expect(daysLeftInWeek('2026-09-07', '2026-09-13')).toBe(1)
    expect(daysLeftInWeek('2026-09-07', '2026-09-14')).toBe(0)
  })

  it('enumerates inclusive week ranges and refuses inverted ones', () => {
    expect(eachWeekKey('2026-09-07', '2026-09-21')).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
    expect(eachWeekKey('2026-09-21', '2026-09-07')).toEqual([])
  })
})
