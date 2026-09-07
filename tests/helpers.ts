import { civilToInstant, type DayConfig } from '../src/core/dayKey'

export const NY: DayConfig = { dayStartMinute: 240, timeZone: 'America/New_York' }
export const HOUR = 3_600_000

/**
 * Build an instant from a New York wall clock: wallClock('2026-03-08T03:45').
 *
 * This goes through civilToInstant rather than adding milliseconds to midnight,
 * because adding 3.75 real hours to midnight on a spring-forward day lands at 04:45,
 * not 03:45. That is the bug this whole module exists to prevent, and the first draft
 * of this helper had it.
 */
export const wallClock = (iso: string, cfg: DayConfig = NY): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(iso)
  if (!m) throw new Error(`Bad wall clock: ${iso}`)
  return civilToInstant(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
      second: 0,
    },
    cfg.timeZone,
  )
}

export const hhmm = (d: Date, cfg: DayConfig = NY): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: cfg.timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
