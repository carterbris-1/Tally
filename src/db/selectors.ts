/** Derived reads. Pure over a snapshot, so they stay cheap and testable. */

import { addDayKey, type DayConfig } from '../core/dayKey'
import { dailyTotals, entriesForOwner, skippedDays } from '../core/aggregate'
import {
  computeStreaks,
  computeWeeklyStreaks,
  effectiveGoal,
  evaluateDay,
  type DayStatus,
  type StreakResult,
} from '../core/streak'
import { daysInWeek, daysLeftInWeek, isWeekEnded, weekKeyFor } from '../core/weekKey'
import { isScheduled } from '../core/schedule'
import { isRunning } from '../core/sessionSplit'
import { currentPhase, weightedProgress } from '../core/progress'
import { plannedEndMinute } from '../core/repack'
import { groupByName, groupNames, type Group } from '../core/grouping'
import type { Block, Entry, Phase, Project, Task, Todo } from '../core/types'
import type { Snapshot } from './store'

const alive = <T extends { deletedAt: string | null }>(rows: readonly T[]): T[] => rows.filter((r) => !r.deletedAt)

export const liveTasks = (s: Snapshot): Task[] =>
  alive(s.tasks)
    .filter((t) => !t.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder)

export const archivedTasks = (s: Snapshot): Task[] => alive(s.tasks).filter((t) => t.isArchived)

export const taskEntries = (s: Snapshot, taskId: string): Entry[] => entriesForOwner(s.entries, 'task', taskId)
export const blockEntries = (s: Snapshot, blockId: string): Entry[] => entriesForOwner(s.entries, 'block', blockId)

export interface TaskToday {
  task: Task
  /** Today's total for a daily task, week-to-date for a weekly one. */
  total: number
  goalValue: number
  status: DayStatus
  scheduled: boolean
  skipped: boolean
  running: Entry | null
  /** 0-1, clamped. For a limit task this is consumption of the allowance. */
  fraction: number
  /** null for a daily task; days remaining in the week for a weekly one. */
  daysLeft: number | null
}

export function taskToday(
  s: Snapshot,
  task: Task,
  dayKey: string,
  cfg: DayConfig,
  now: number,
  weekStartDay = 1,
): TaskToday {
  const entries = taskEntries(s, task.id)
  const totals = dailyTotals(entries, task.kind, cfg, now)
  const skips = skippedDays(entries)
  const goal = effectiveGoal(task.kind, task.goalDirection, task.goalValue)
  const weekly = task.goalPeriod === 'week'

  let total: number
  let scheduled: boolean
  let skipped: boolean
  let ended: boolean
  let daysLeft: number | null = null

  if (weekly) {
    // the period is the week, so everything below is measured over its seven days
    const weekKey = weekKeyFor(dayKey, weekStartDay)
    const days = daysInWeek(weekKey)
    const scheduledDays = days.filter((d) => isScheduled(task.schedule, d))
    total = days.reduce((sum, d) => sum + (totals.get(d) ?? 0), 0)
    scheduled = scheduledDays.length > 0
    skipped = scheduledDays.length > 0 && scheduledDays.every((d) => skips.has(d))
    ended = isWeekEnded(weekKey, cfg, now)
    daysLeft = daysLeftInWeek(weekKey, dayKey)
  } else {
    total = totals.get(dayKey) ?? 0
    scheduled = isScheduled(task.schedule, dayKey)
    skipped = skips.has(dayKey)
    ended = false
  }

  const status = evaluateDay({ goal, total, isSkip: skipped, scheduled, dayEnded: ended })
  const running = entries.find((e) => isRunning(e.startedAt, e.endedAt)) ?? null
  const denominator = goal.value > 0 ? goal.value : Math.max(total, 1)
  return {
    task,
    total,
    goalValue: goal.value,
    status,
    scheduled,
    skipped,
    running,
    fraction: Math.min(1, total / denominator),
    daysLeft,
  }
}

/** Days for a daily task, weeks for a weekly one. The statuses are keyed accordingly. */
export const streaksFor = (
  s: Snapshot,
  task: Task,
  cfg: DayConfig,
  now: number,
  weekStartDay = 1,
): StreakResult =>
  task.goalPeriod === 'week'
    ? computeWeeklyStreaks(task, taskEntries(s, task.id), cfg, weekStartDay, now)
    : computeStreaks(task, taskEntries(s, task.id), cfg, now)

/** Heatmap data: status per day for the last `days` days, oldest first. */
export function heatmap(s: Snapshot, task: Task, cfg: DayConfig, now: number, days: number, todayKey: string): Array<{ dayKey: string; status: DayStatus }> {
  const { statuses } = computeStreaks(task, taskEntries(s, task.id), cfg, now)
  const out: Array<{ dayKey: string; status: DayStatus }> = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = addDayKey(todayKey, -i)
    out.push({ dayKey: key, status: statuses.get(key) ?? 'neutral' })
  }
  return out
}

export function dayTotalsFor(s: Snapshot, task: Task, cfg: DayConfig, now: number): Map<string, number> {
  return dailyTotals(taskEntries(s, task.id), task.kind, cfg, now)
}

// ------------------------------------------------------------------- to-dos

export const liveTodos = (s: Snapshot): Todo[] =>
  alive(s.todos).sort((a, b) => a.sortOrder - b.sortOrder)

export const openTodos = (s: Snapshot): Todo[] => liveTodos(s).filter((t) => t.completedAt === null)
export const doneTodos = (s: Snapshot): Todo[] =>
  liveTodos(s)
    .filter((t) => t.completedAt !== null)
    .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))

export const isOverdue = (t: Todo, now: number): boolean =>
  t.completedAt === null && t.dueDate !== null && Date.parse(t.dueDate) < now

// ---------------------------------------------------------------- day plans

export const planFor = (s: Snapshot, dayKey: string) => alive(s.dayPlans).find((p) => p.dayKey === dayKey) ?? null

export const blocksFor = (s: Snapshot, planId: string): Block[] =>
  alive(s.blocks)
    .filter((b) => b.planId === planId)
    .sort((a, b) => a.sortOrder - b.sortOrder)

export interface BlockView {
  block: Block
  actualSeconds: number
  varianceMinutes: number
  running: Entry | null
  endMinute: number
}

export function blockView(s: Snapshot, block: Block, cfg: DayConfig, now: number): BlockView {
  const entries = blockEntries(s, block.id)
  const actualSeconds = [...dailyTotals(entries, 'timer', cfg, now).values()].reduce((a, b) => a + b, 0)
  return {
    block,
    actualSeconds,
    varianceMinutes: Math.round(actualSeconds / 60) - block.plannedMinutes,
    running: entries.find((e) => isRunning(e.startedAt, e.endedAt)) ?? null,
    endMinute: plannedEndMinute(block),
  }
}

// ----------------------------------------------------------------- projects

export const liveProjects = (s: Snapshot): Project[] =>
  alive(s.projects).sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || a.createdAt.localeCompare(b.createdAt))

export const phasesFor = (s: Snapshot, projectId: string): Phase[] =>
  alive(s.phases)
    .filter((p) => p.projectId === projectId)
    .sort((a, b) => a.sortOrder - b.sortOrder)

export interface ProjectView {
  project: Project
  phases: Phase[]
  progress: number
  current: Phase | null
  estimatedHours: number
}

export function projectView(s: Snapshot, project: Project): ProjectView {
  const phases = phasesFor(s, project.id)
  return {
    project,
    phases,
    progress: weightedProgress(phases),
    current: currentPhase(phases),
    estimatedHours: phases.reduce((sum, p) => sum + Math.max(0, p.estimatedHours), 0),
  }
}

export const todosForPhase = (s: Snapshot, phaseId: string): Todo[] =>
  liveTodos(s).filter((t) => t.phaseId === phaseId)

/** Projects under their group headings, ungrouped last. */
export const groupedProjects = (s: Snapshot): Array<Group<Project>> => groupByName(liveProjects(s))

/** Existing group names, for the picker's suggestions. */
export const projectGroupNames = (s: Snapshot): string[] => groupNames(liveProjects(s))

// ------------------------------------------------------------------ running

export const runningEntries = (s: Snapshot): Entry[] =>
  alive(s.entries).filter((e) => isRunning(e.startedAt, e.endedAt))

/** Entries whose owner is gone. Surfaced in Settings, never deleted silently. */
export function orphans(s: Snapshot): Entry[] {
  const known = new Set<string>([
    ...alive(s.tasks).map((t) => t.id),
    ...alive(s.blocks).map((b) => b.id),
    ...alive(s.phases).map((p) => p.id),
  ])
  return alive(s.entries).filter((e) => !known.has(e.ownerId))
}
