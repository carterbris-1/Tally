import { describe, expect, it } from 'vitest'
import {
  addDayKey,
  dayEndInstant,
  dayKeyFor,
  dayLengthMs,
  dayMinuteFor,
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

describe('dayMinuteFor', () => {
  it('is the exact inverse of instantForDayMinute, on days of every length', () => {
    for (const key of ['2026-09-01', '2026-03-07', '2026-10-31']) {
      for (const minute of [0, 1, 60, 359, 360, 720, 1200, 1380, 1439, 1440]) {
        expect(dayMinuteFor(instantForDayMinute(key, minute, NY), key, NY)).toBe(minute)
      }
    }
  })

  it('reads the wall clock, so 14:05 is the same minute whatever the day is worth', () => {
    const normal = dayMinuteFor(ny('2026-09-01T14:05'), '2026-09-01', NY)
    const short = dayMinuteFor(ny('2026-03-07T14:05'), '2026-03-07', NY)
    const long = dayMinuteFor(ny('2026-10-31T14:05'), '2026-10-31', NY)
    expect(normal).toBe(605) // 14:05 is 10h05 after a 04:00 start
    expect(short).toBe(605)
    expect(long).toBe(605)
  })

  it('does not count elapsed time across the hour the clocks go back', () => {
    // 03:00 on the 2nd is 24 real hours after the 25-hour day began, but the wall
    // clock says 23, and a block belongs where the wall clock puts it
    const at = ny('2026-11-01T03:00')
    const elapsed = (at.getTime() - dayStartInstant('2026-10-31', NY).getTime()) / 60_000
    expect(elapsed).toBe(1440) // what the tempting subtraction would have returned
    expect(dayMinuteFor(at, '2026-10-31', NY)).toBe(1380)
  })

  it('does not count elapsed time across the hour the clocks go forward', () => {
    const at = ny('2026-03-08T03:00')
    const elapsed = (at.getTime() - dayStartInstant('2026-03-07', NY).getTime()) / 60_000
    expect(elapsed).toBe(1320)
    expect(dayMinuteFor(at, '2026-03-07', NY)).toBe(1380)
  })

  it('lands inside 0..1440 for any instant, paired with its own day key', () => {
    // walk a DST weekend in ten-minute steps; every instant must sit within its day
    let t = ny('2026-10-30T12:00').getTime()
    const end = ny('2026-11-02T12:00').getTime()
    while (t < end) {
      const minute = dayMinuteFor(t, dayKeyFor(t, NY), NY)
      expect(minute).toBeGreaterThanOrEqual(0)
      expect(minute).toBeLessThan(1440)
      t += 10 * 60_000
    }
  })

  it('goes negative for an instant before the day it is asked about began', () => {
    // 02:00 belongs to the previous tally day; the sign says so rather than wrapping
    expect(dayMinuteFor(ny('2026-09-01T02:00'), '2026-09-01', NY)).toBe(-120)
    expect(dayMinuteFor(ny('2026-09-01T02:00'), '2026-08-31', NY)).toBe(1320)
  })

  it('maps both passes of a repeated hour onto the same minute', () => {
    // 01:30 happens twice on 2026-11-01. There is one minute index for it, so the
    // second pass is indistinguishable from the first once stored.
    const first = ny('2026-11-01T01:30')
    const second = new Date(first.getTime() + HOUR)
    expect(hhmm(second)).toBe('01:30')
    expect(dayMinuteFor(second, '2026-10-31', NY)).toBe(dayMinuteFor(first, '2026-10-31', NY))
  })
})
