/** Shared domain types. No React, no IndexedDB, no Supabase in this directory. */

import { DEFAULT_TOPICS, type ReadKind } from './reading'
export type { ReadKind }

export type TaskKind = 'timer' | 'quantity' | 'checkbox'
export type GoalDirection = 'atLeast' | 'atMost' | 'none'
/** Whether goalValue is a daily total or a weekly one. */
export type GoalPeriod = 'day' | 'week'
export type OwnerType = 'task' | 'block' | 'phase'

/**
 * Which days are an opportunity. It does NOT say how much — that is the goal.
 *
 * `timesPerWeek` used to live here and was deleted: "any 3 days this week" is a goal of
 * `atLeast 3` over a weekly period, not a schedule. Keeping both meant two mechanisms
 * that could disagree. Stored tasks carrying it are migrated on read.
 */
export type Schedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] } // 0 = Sunday

/** Every synced row carries these. */
export interface Syncable {
  id: string
  updatedAt: string // ISO-8601 UTC, drives last-write-wins
  deletedAt: string | null // soft delete, so deletions propagate
}

export interface Task extends Syncable {
  title: string
  kind: TaskKind
  goalDirection: GoalDirection
  /** 'day' unless stated. 'week' makes goalValue a weekly total, not a daily one. */
  goalPeriod: GoalPeriod
  goalValue: number | null // seconds for timer, raw number for quantity
  unitLabel: string
  schedule: Schedule
  quickAdds: number[]
  colorHex: string
  symbolName: string
  sortOrder: number
  /**
   * Stopping a timer on this task drops a completed block onto that day's plan.
   * Absent on tasks created before the flag existed, which reads as false.
   */
  logToPlan: boolean
  isArchived: boolean
  createdAt: string
}

export interface Entry extends Syncable {
  ownerType: OwnerType
  ownerId: string
  dayKey: string
  startedAt: string | null // timer only
  endedAt: string | null // timer only; null while startedAt is set = running
  amount: number // quantity, or 1 for a checked checkbox
  note: string
  isSkip: boolean // task owners only
  createdAt: string
}

export interface Todo extends Syncable {
  title: string
  notes: string
  dueDate: string | null
  isFlagged: boolean
  completedAt: string | null
  sortOrder: number
  linkedTaskId: string | null
  phaseId: string | null
}

/** The one thing chosen for a day. One row per dayKey, including days not yet reached. */
export interface DailyRead extends Syncable {
  dayKey: string
  kind: ReadKind
  title: string
  author: string
  url: string
  topic: string
  minutes: number
  year: number | null
  source: 'hn' | 'openalex' | 'crossref'
  /** Stable per item; what the 90-day dedupe window matches on. */
  sourceId: string
  /** A sentence or two of what it is, when the source gives us one. May be empty. */
  blurb: string
  openedAt: string | null
  finishedAt: string | null
  skippedAt: string | null
  savedAt: string | null
  createdAt: string
}

export interface DayPlan extends Syncable {
  dayKey: string
  note: string
  createdAt: string
}

export interface Block extends Syncable {
  planId: string
  title: string
  plannedStartMinute: number // minutes since day start, NOT a timestamp
  plannedMinutes: number
  note: string
  colorHex: string
  completedAt: string | null
  sortOrder: number
}

export interface Project extends Syncable {
  title: string
  /** Free text: "house", "dev", "travel". Empty means ungrouped. Matched case-insensitively. */
  group: string
  notes: string
  targetDate: string | null
  colorHex: string
  isArchived: boolean
  createdAt: string
}

export interface Phase extends Syncable {
  projectId: string
  title: string
  notes: string
  estimatedHours: number
  completedAt: string | null
  sortOrder: number
}

/** User settings. Synced as a single row. */
export interface Settings {
  dayStartMinute: number // minutes past local midnight; default 240 = 04:00
  weekStartDay: number // 0 = Sunday
  skipDaysPerMonth: number | null // null = unlimited
  /**
   * IANA zone, e.g. "America/New_York". Never a fixed offset: "EST" is UTC-5 all year,
   * so it would put every day key an hour out from March to November. The zone name
   * carries its own DST rules, which is what the day-boundary tests rely on.
   */
  timeZone: string
  todoRetentionDays: number
  /** topic -> weight, 0 means never. Drives what the daily read offers. */
  readTopics: Record<string, number>
  /** Length budget in minutes. Relaxed only to avoid repeating something. */
  readMinutesMax: number
  /** Opening the day's piece starts this timer, the way a to-do can. */
  readLinkedTaskId: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  dayStartMinute: 240,
  weekStartDay: 1,
  skipDaysPerMonth: 2,
  // Pinned to Eastern rather than read from the device. A tracker whose day boundary
  // follows you across timezones shifts your history every time you travel; one that
  // stays home does not. Changeable in Settings.
  timeZone: 'America/New_York',
  todoRetentionDays: 30,
  readTopics: DEFAULT_TOPICS,
  readMinutesMax: 30,
  readLinkedTaskId: null,
}
