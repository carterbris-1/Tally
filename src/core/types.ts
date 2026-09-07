/** Shared domain types. No React, no IndexedDB, no Supabase in this directory. */

export type TaskKind = 'timer' | 'quantity' | 'checkbox'
export type GoalDirection = 'atLeast' | 'atMost' | 'none'
export type OwnerType = 'task' | 'block' | 'phase'

export type Schedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] } // 0 = Sunday
  | { type: 'timesPerWeek'; n: number }

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
  goalValue: number | null // seconds for timer, raw number for quantity
  unitLabel: string
  schedule: Schedule
  quickAdds: number[]
  colorHex: string
  symbolName: string
  sortOrder: number
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
}
