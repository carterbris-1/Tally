import { describe, expect, it } from 'vitest'
import {
  addDayKey,
  dayEndInstant,
  dayKeyFor,
  dayLengthMs,
  dayStartInstant,
  eachDayKey,
  instantForDayMinute,
  isDayEnded,
  weekdayOf,
} from '../../src/core/dayKey'
import { HOUR, NY, hhmm, wallClock as ny } from '../helpers'

describe('dayKeyFor', () => {
  it('puts late-night activity on the previous day', () => {
    expect(dayKeyFor(ny('2026-09-01T00:30'), NY)).toBe('2026-08-31')
    expect(dayKeyFor(ny('2026-09-01T03:59'), NY)).toBe('2026-08-31')
  })

  it('rolls over exactly at the day start', () => {
    expect(dayKeyFor(ny('2026-09-01T04:00'), NY)).toBe('2026-09-01')
    expect(dayKeyFor(ny('2026-09-01T23:59'), NY)).toBe('2026-09-01')
  })

  it('changes answer when the day start moves', () => {
    const instant = ny('2026-09-01T04:30')
    expect(dayKeyFor(instant, NY)).toBe('2026-09-01')
    expect(dayKeyFor(instant, { ...NY, dayStartMinute: 300 })).toBe('2026-08-31')
  })

  it('is timezone-aware, not offset-aware', () => {
    const instant = ny('2026-09-01T04:30') // 08:30 UTC
    expect(dayKeyFor(instant, NY)).toBe('2026-09-01')
    expect(dayKeyFor(instant, { ...NY, timeZone: 'Australia/Sydney' })).toBe('2026-09-01')
    expect(dayKeyFor(instant, { ...NY, timeZone: 'Europe/London' })).toBe('2026-09-01')
  })
})

describe('DST', () => {
  it('gives the spring-forward day 23 real hours', () => {
    // clocks jump 02:00 -> 03:00 on 2026-03-08, inside the day that starts 2026-03-07
    expect(dayLengthMs('2026-03-07', NY)).toBe(23 * HOUR)
  })

  it('gives the fall-back day 25 real hours', () => {
    // clocks fall 02:00 -> 01:00 on 2026-11-01
    expect(dayLengthMs('2026-10-31', NY)).toBe(25 * HOUR)
  })

  it('keeps every other day at 24 hours', () => {
    expect(dayLengthMs('2026-09-01', NY)).toBe(24 * HOUR)
    expect(dayLengthMs('2026-03-06', NY)).toBe(24 * HOUR)
    expect(dayLengthMs('2026-11-02', NY)).toBe(24 * HOUR)
  })

  it('starts each day at 04:00 wall clock on both sides of a transition', () => {
    for (const key of ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01']) {
      expect(hhmm(dayStartInstant(key, NY))).toBe('04:00')
    }
  })

  it('resolves planned minutes by wall clock, compressing the tail of a short day', () => {
    // minute 360 is "10:00" on any day, DST or not
    const normal = instantForDayMinute('2026-09-01', 360, NY)
    const short = instantForDayMinute('2026-03-07', 360, NY)
    expect(hhmm(normal)).toBe('10:00')
    expect(hhmm(short)).toBe('10:00')

    // ...but only 22 real hours have elapsed at minute 1380 of the 23-hour day
    const late = instantForDayMinute('2026-03-07', 1380, NY)
    expect(late.getTime() - dayStartInstant('2026-03-07', NY).getTime()).toBe(22 * HOUR)
    expect(dayEndInstant('2026-03-07', NY).getTime() - late.getTime()).toBe(HOUR)
  })
})

describe('day key arithmetic', () => {
  it('crosses month and year boundaries', () => {
    expect(addDayKey('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDayKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDayKey('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })

  it('reports weekdays without drifting', () => {
    expect(weekdayOf('2026-09-06')).toBe(0) // Sunday
    expect(weekdayOf('2026-09-07')).toBe(1)
  })

  it('enumerates inclusive ranges and refuses inverted ones', () => {
    expect(eachDayKey('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01'])
    expect(eachDayKey('2026-09-01', '2026-08-30')).toEqual([])
  })

  it('knows when a day has ended', () => {
    expect(isDayEnded('2026-09-01', NY, ny('2026-09-01T23:00'))).toBe(false)
    expect(isDayEnded('2026-09-01', NY, ny('2026-09-02T03:59'))).toBe(false)
    expect(isDayEnded('2026-09-01', NY, ny('2026-09-02T04:00'))).toBe(true)
  })
})
