import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/core/types'
import { dayKeyFor, dayStartInstant, type DayConfig } from '../../src/core/dayKey'
import { wallClock } from '../helpers'

const EASTERN: DayConfig = { dayStartMinute: 240, timeZone: 'America/New_York' }
const PACIFIC: DayConfig = { dayStartMinute: 240, timeZone: 'America/Los_Angeles' }

const zoneAbbr = (d: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')!.value

describe('the app is pinned to Eastern', () => {
  it('defaults to the America/New_York zone', () => {
    expect(DEFAULT_SETTINGS.timeZone).toBe('America/New_York')
  })

  it('does not read the zone from whatever device it opens on', () => {
    // this suite runs on a Pacific machine; the default must not follow it
    expect(DEFAULT_SETTINGS.timeZone).not.toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('starts the day at 04:00 Eastern, not 04:00 wherever you are', () => {
    const start = dayStartInstant('2026-09-07', EASTERN)
    const eastern = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(start)
    const pacific = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(start)

    expect(eastern).toBe('04:00')
    expect(pacific).toBe('01:00') // same instant, three hours earlier out west
  })

  it('assigns a different day than a Pacific device would, and that is the point', () => {
    // 05:00 Eastern is 02:00 Pacific — past the Eastern day start, before the Pacific one
    const instant = wallClock('2026-09-07T05:00', EASTERN)
    expect(dayKeyFor(instant, EASTERN)).toBe('2026-09-07')
    expect(dayKeyFor(instant, PACIFIC)).toBe('2026-09-06')
  })
})

describe('why it is a zone name and not a fixed offset', () => {
  it('is EDT in summer and EST in winter, tracked automatically', () => {
    expect(zoneAbbr(wallClock('2026-07-15T12:00', EASTERN), 'America/New_York')).toBe('EDT')
    expect(zoneAbbr(wallClock('2026-01-15T12:00', EASTERN), 'America/New_York')).toBe('EST')
  })

  it('would be an hour out for most of the year if EST were hardcoded as UTC-5', () => {
    // a fixed UTC-5 reading of a July instant lands an hour off the real wall clock
    const july = wallClock('2026-07-15T23:30', EASTERN)
    const real = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(july)
    const fixedOffset = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Etc/GMT+5', // "EST" as a permanent offset
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(july)

    expect(real).toBe('23:30')
    expect(fixedOffset).toBe('22:30')

    // and that hour is enough to move a late-evening entry onto the wrong day
    const lateNight = wallClock('2026-07-16T00:30', EASTERN)
    expect(dayKeyFor(lateNight, EASTERN)).toBe('2026-07-15')
    expect(dayKeyFor(lateNight, { dayStartMinute: 240, timeZone: 'Etc/GMT+5' })).toBe('2026-07-15')
    // ...they agree here, but the boundary itself sits an hour apart:
    expect(dayStartInstant('2026-07-16', EASTERN).getTime()).not.toBe(
      dayStartInstant('2026-07-16', { dayStartMinute: 240, timeZone: 'Etc/GMT+5' }).getTime(),
    )
  })

  it('still gets the DST day lengths right on the pinned zone', () => {
    const springStart = dayStartInstant('2026-03-07', EASTERN).getTime()
    const springEnd = dayStartInstant('2026-03-08', EASTERN).getTime()
    expect(springEnd - springStart).toBe(23 * 3_600_000)
  })
})
