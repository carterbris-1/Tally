/**
 * Streaks.
 *
 * Entries are the source of truth. Streaks are recomputed, never incremented — an
 * incremented counter drifts and you do not notice for months. The result is cached
 * in memory for list rendering and never persisted or synced.
 */

import { addDayKey, compareDayKeys, dayKeyFor, isDayEnded, type DayConfig } from './dayKey'
import { isScheduled } from './schedule'
import type { Entry, GoalDirection, Task, TaskKind } from './types'
import { dailyTotals, skippedDays } from './aggregate'

export type DayStatus = 'complete' | 'incomplete' | 'neutral' | 'unresolved'

export interface EffectiveGoal {
  direction: GoalDirection
  value: number
}

/** Checkbox tasks are implicitly `atLeast 1`; a task with no goal value just tracks. */
export function effectiveGoal(kind: TaskKind, direction: GoalDirection, value: number | null): EffectiveGoal {
  if (kind === 'checkbox') return { direction: 'atLeast', value: 1 }
  if (direction === 'none' || value === null) return { direction: 'none', value: 0 }
  return { direction, value }
}

/**
 * Resolve one day.
 *
 * The `atMost` asymmetry is the whole point: a limit cannot be called complete while
 * the day is still running, but it can be called failed the moment it is exceeded.
 */
export function evaluateDay(input: {
  goal: EffectiveGoal
  total: number
  isSkip: boolean
  scheduled: boolean
  dayEnded: boolean
}): DayStatus {
  const { goal, total, isSkip, scheduled, dayEnded } = input
  if (isSkip || !scheduled) return 'neutral'

  switch (goal.direction) {
    case 'atLeast':
      if (total >= goal.value) return 'complete'
      return dayEnded ? 'incomplete' : 'unresolved'
    case 'atMost':
      if (total > goal.value) return 'incomplete' // over is over, immediately
      return dayEnded ? 'complete' : 'unresolved'
    case 'none':
      if (total > 0) return 'complete'
      return dayEnded ? 'incomplete' : 'unresolved'
  }
}

export interface StreakResult {
  current: number
  longest: number
  totalCompletions: number
  statuses: Map<string, DayStatus>
}

/**
 * Walk every day from the task's first activity to today.
 *
 * Backwards from today for the current streak, skipping neutral and unresolved days;
 * an unresolved day is only ever today or later, so skipping it is what "today is
 * excluded until the day ends" means in code.
 */
export function computeStreaks(
  task: Pick<Task, 'kind' | 'goalDirection' | 'goalValue' | 'schedule' | 'createdAt'>,
  entries: Entry[],
  cfg: DayConfig,
  now: Date | number = Date.now(),
): StreakResult {
  const goal = effectiveGoal(task.kind, task.goalDirection, task.goalValue)
  const totals = dailyTotals(entries, task.kind, cfg, now)
  const skips = skippedDays(entries)
  const todayKey = dayKeyFor(now, cfg)

  let firstKey = dayKeyFor(Date.parse(task.createdAt), cfg)
  for (const key of [...totals.keys(), ...skips]) {
    if (compareDayKeys(key, firstKey) < 0) firstKey = key
  }

  const statuses = new Map<string, DayStatus>()
  const statusAt = (key: string): DayStatus => {
    const cached = statuses.get(key)
    if (cached) return cached
    const s = evaluateDay({
      goal,
      total: totals.get(key) ?? 0,
      isSkip: skips.has(key),
      scheduled: isScheduled(task.schedule, key),
      dayEnded: isDayEnded(key, cfg, now),
    })
    statuses.set(key, s)
    return s
  }

  let longest = 0
  let run = 0
  let totalCompletions = 0
  for (let key = firstKey; compareDayKeys(key, todayKey) <= 0; key = addDayKey(key, 1)) {
    const s = statusAt(key)
    if (s === 'complete') {
      run += 1
      totalCompletions += 1
      if (run > longest) longest = run
    } else if (s === 'incomplete') {
      run = 0
    }
  }

  let current = 0
  for (let key = todayKey; compareDayKeys(key, firstKey) >= 0; key = addDayKey(key, -1)) {
    const s = statusAt(key)
    if (s === 'complete') current += 1
    else if (s === 'incomplete') break
    // neutral and unresolved days pass through without counting or breaking
  }

  return { current, longest, totalCompletions, statuses }
}

/** How a limit task reads today: never "complete", only on track or blown. */
export function limitStatusToday(total: number, goal: EffectiveGoal): 'onTrack' | 'exceeded' {
  return total > goal.value ? 'exceeded' : 'onTrack'
}

/** Skip-day allowance is per calendar month of the dayKey, not a rolling window. */
export function skipsUsedInMonth(entries: Entry[], dayKey: string): number {
  const prefix = dayKey.slice(0, 7) // "2026-09"
  let n = 0
  for (const key of skippedDays(entries)) if (key.startsWith(prefix)) n += 1
  return n
}
