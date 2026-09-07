/**
 * Splitting timer sessions across the day boundary.
 *
 * Sessions are stored whole and split at read time. A session from 03:30 to 05:00
 * with a 04:00 day start contributes 30 minutes to yesterday and 60 to today.
 */

import { dayEndInstant, dayKeyFor, type DayConfig } from './dayKey'

export interface DaySlice {
  dayKey: string
  seconds: number
}

const asMs = (v: Date | number | string): number =>
  typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v.getTime()

/**
 * Per-day contributions of one session. Ascending by day, no zero-length slices.
 *
 * A session spanning many days produces many slices; the loop is bounded by the
 * session length, and a non-advancing boundary breaks out rather than hanging.
 */
export function splitSession(
  startedAt: Date | number | string,
  endedAt: Date | number | string,
  cfg: DayConfig,
): DaySlice[] {
  const start = asMs(startedAt)
  const end = asMs(endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []

  const slices: DaySlice[] = []
  let cursor = start
  while (cursor < end) {
    const key = dayKeyFor(cursor, cfg)
    const boundary = dayEndInstant(key, cfg).getTime()
    if (boundary <= cursor) break // malformed config; refuse to loop
    const sliceEnd = Math.min(boundary, end)
    slices.push({ dayKey: key, seconds: (sliceEnd - cursor) / 1000 })
    cursor = sliceEnd
  }
  return slices
}

/** Elapsed seconds of a session, running or finished. Never accumulated, always derived. */
export function sessionSeconds(
  startedAt: string | null,
  endedAt: string | null,
  now: Date | number = Date.now(),
): number {
  if (!startedAt) return 0
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return 0
  const end = endedAt ? Date.parse(endedAt) : asMs(now)
  return Math.max(0, (end - start) / 1000)
}

export function isRunning(startedAt: string | null, endedAt: string | null): boolean {
  return startedAt !== null && endedAt === null
}
