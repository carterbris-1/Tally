/**
 * Rollups for the stats screen.
 *
 * Pure over entries and a window. The expensive part is that every function here walks
 * a day range per task, so callers memoise on `(entries, dayKey)` rather than `now` —
 * a running timer changes today's total continuously, but not last month's.
 */

import { addDayKey, compareDayKeys, eachDayKey, isDayEnded, zonedParts, type DayConfig } from './dayKey'
import { dailyTotals, skippedDays } from './aggregate'
import { isScheduled } from './schedule'
import { effectiveGoal, evaluateDay } from './streak'
import { daysInWeek, eachWeekKey, isWeekEnded, weekKeyFor } from './weekKey'
import type { Entry, Task, TaskKind } from './types'

export type StatsWindow = 'week' | 'month' | 'all'

export interface DayRange {
  from: string
  to: string
}

/** First day of the month a day belongs to. */
export const startOfMonth = (dayKey: string): string => `${dayKey.slice(0, 7)}-01`

export function rangeFor(window: StatsWindow, todayKey: string, weekStartDay: number, earliest: string): DayRange {
  switch (window) {
    case 'week':
      return { from: weekKeyFor(todayKey, weekStartDay), to: todayKey }
    case 'month':
      return { from: startOfMonth(todayKey), to: todayKey }
    case 'all':
      return { from: compareDayKeys(earliest, todayKey) <= 0 ? earliest : todayKey, to: todayKey }
  }
}

export interface TaskStats {
  total: number
  /** Days with any activity at all. "I read on 14 days this month." */
  activeDays: number
  /** Days met, or weeks met for a weekly task. */
  completePeriods: number
  scheduledPeriods: number
  /** 0-1. Zero scheduled periods reports 0 rather than dividing by zero. */
  rate: number
  periodLabel: 'days' | 'weeks'
}

export function statsForTask(
  task: Pick<Task, 'kind' | 'goalDirection' | 'goalPeriod' | 'goalValue' | 'schedule'>,
  entries: Entry[],
  cfg: DayConfig,
  weekStartDay: number,
  range: DayRange,
  now: Date | number = Date.now(),
): TaskStats {
  const totals = dailyTotals(entries, task.kind, cfg, now)
  const skips = skippedDays(entries)
  const goal = effectiveGoal(task.kind, task.goalDirection, task.goalValue)
  const days = eachDayKey(range.from, range.to)

  const total = days.reduce((sum, d) => sum + (totals.get(d) ?? 0), 0)
  const activeDays = days.filter((d) => (totals.get(d) ?? 0) > 0).length

  if (task.goalPeriod === 'week') {
    const weeks = eachWeekKey(weekKeyFor(range.from, weekStartDay), weekKeyFor(range.to, weekStartDay))
    let complete = 0
    let scheduled = 0
    for (const w of weeks) {
      const wd = daysInWeek(w)
      const scheduledDays = wd.filter((d) => isScheduled(task.schedule, d))
      if (scheduledDays.length === 0) continue
      if (scheduledDays.every((d) => skips.has(d))) continue
      scheduled += 1
      const status = evaluateDay({
        goal,
        total: wd.reduce((sum, d) => sum + (totals.get(d) ?? 0), 0),
        isSkip: false,
        scheduled: true,
        dayEnded: isWeekEnded(w, cfg, now),
      })
      if (status === 'complete') complete += 1
    }
    return {
      total,
      activeDays,
      completePeriods: complete,
      scheduledPeriods: scheduled,
      rate: scheduled === 0 ? 0 : complete / scheduled,
      periodLabel: 'weeks',
    }
  }

  let complete = 0
  let scheduled = 0
  for (const d of days) {
    if (!isScheduled(task.schedule, d) || skips.has(d)) continue
    scheduled += 1
    const status = evaluateDay({
      goal,
      total: totals.get(d) ?? 0,
      isSkip: false,
      scheduled: true,
      dayEnded: isDayEnded(d, cfg, now),
    })
    if (status === 'complete') complete += 1
  }

  return {
    total,
    activeDays,
    completePeriods: complete,
    scheduledPeriods: scheduled,
    rate: scheduled === 0 ? 0 : complete / scheduled,
    periodLabel: 'days',
  }
}

/**
 * Seconds per hour-of-day, 24 buckets, for timer sessions.
 *
 * A session is attributed entirely to the hour it **started**. Spreading a three-hour
 * session across three buckets would answer "when was I busy"; this answers "when do I
 * sit down to do it", which is the question the histogram is actually for.
 */
export function timeOfDayBuckets(
  entries: Entry[],
  cfg: DayConfig,
  range: DayRange,
  now: Date | number = Date.now(),
): number[] {
  const buckets = new Array<number>(24).fill(0)
  const end = typeof now === 'number' ? now : now.getTime()
  for (const e of entries) {
    if (e.deletedAt || e.isSkip || !e.startedAt) continue
    if (compareDayKeys(e.dayKey, range.from) < 0 || compareDayKeys(e.dayKey, range.to) > 0) continue
    const started = Date.parse(e.startedAt)
    if (!Number.isFinite(started)) continue
    const seconds = ((e.endedAt ? Date.parse(e.endedAt) : end) - started) / 1000
    if (seconds <= 0) continue
    const hour = zonedParts(started, cfg.timeZone).hour
    buckets[hour] = (buckets[hour] ?? 0) + seconds
  }
  return buckets
}

/** The earliest day any of these entries touches, for the "all time" window. */
export function earliestDay(entries: Entry[], fallback: string): string {
  let earliest = fallback
  for (const e of entries) {
    if (e.deletedAt) continue
    if (compareDayKeys(e.dayKey, earliest) < 0) earliest = e.dayKey
  }
  return earliest
}

/** Totals per month, oldest first, for a sparkline or a simple bar list. */
export function monthlyTotals(
  entries: Entry[],
  kind: TaskKind,
  cfg: DayConfig,
  range: DayRange,
  now: Date | number = Date.now(),
): Array<{ month: string; total: number }> {
  const totals = dailyTotals(entries, kind, cfg, now)
  const out = new Map<string, number>()
  for (const d of eachDayKey(range.from, range.to)) {
    const month = d.slice(0, 7)
    out.set(month, (out.get(month) ?? 0) + (totals.get(d) ?? 0))
  }
  return [...out.entries()].map(([month, total]) => ({ month, total }))
}

/** Yesterday, for a "vs. previous period" comparison. Kept trivial on purpose. */
export const previousRange = (range: DayRange): DayRange => {
  const span = eachDayKey(range.from, range.to).length
  return { from: addDayKey(range.from, -span), to: addDayKey(range.to, -span) }
}
