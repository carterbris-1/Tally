/**
 * Week keys.
 *
 * A week is identified by the `dayKey` of its first day — `"2026-09-07"`, never
 * `"2026-W37"`. ISO week numbers assume Monday starts the week; `weekStartDay` is
 * configurable, so ISO numbering would be wrong for anyone who sets it to Sunday and
 * wrong at year boundaries for everyone. A day key sorts correctly, needs no special
 * casing, and is the same shape everything else in the app already speaks.
 */

import { addDayKey, compareDayKeys, isDayEnded, weekdayOf, type DayConfig } from './dayKey'

export const DAYS_PER_WEEK = 7

/** The week key containing this day. `weekStartDay`: 0 = Sunday. */
export function weekKeyFor(dayKey: string, weekStartDay: number): string {
  const offset = ((weekdayOf(dayKey) - weekStartDay) % DAYS_PER_WEEK + DAYS_PER_WEEK) % DAYS_PER_WEEK
  return addDayKey(dayKey, -offset)
}

/** The seven day keys of a week, ascending. Always seven, DST or not. */
export function daysInWeek(weekKey: string): string[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDayKey(weekKey, i))
}

export function addWeekKey(weekKey: string, n: number): string {
  return addDayKey(weekKey, n * DAYS_PER_WEEK)
}

/** The last day of the week — what has to close before the week resolves. */
export function lastDayOfWeek(weekKey: string): string {
  return addDayKey(weekKey, DAYS_PER_WEEK - 1)
}

/**
 * A week is over once its final day is over.
 *
 * Deferring to `isDayEnded` keeps the 04:00 boundary and the DST handling in one place:
 * a week containing a transition is 167 or 169 real hours, and none of that arithmetic
 * happens here.
 */
export function isWeekEnded(weekKey: string, cfg: DayConfig, now: Date | number = Date.now()): boolean {
  return isDayEnded(lastDayOfWeek(weekKey), cfg, now)
}

/** Days left in the week, counting today. 7 on the first day, 1 on the last, 0 after. */
export function daysLeftInWeek(weekKey: string, todayKey: string): number {
  const days = daysInWeek(weekKey)
  const index = days.indexOf(todayKey)
  return index === -1 ? 0 : DAYS_PER_WEEK - index
}

/** Inclusive range of week keys, ascending. Empty if inverted. */
export function eachWeekKey(fromWeek: string, toWeek: string): string[] {
  const out: string[] = []
  if (compareDayKeys(fromWeek, toWeek) > 0) return out
  for (let w = fromWeek; compareDayKeys(w, toWeek) <= 0; w = addWeekKey(w, 1)) out.push(w)
  return out
}
