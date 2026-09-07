/** Per-day totals for a task, block or phase. */

import type { DayConfig } from './dayKey'
import type { Entry, OwnerType, TaskKind } from './types'
import { splitSession } from './sessionSplit'

const live = (e: Entry): boolean => e.deletedAt === null

export function entriesForOwner(entries: Entry[], ownerType: OwnerType, ownerId: string): Entry[] {
  return entries.filter((e) => live(e) && e.ownerType === ownerType && e.ownerId === ownerId)
}

/**
 * Totals keyed by day. Seconds for timer owners, raw amounts otherwise.
 *
 * Timer entries are split across the boundary; quantity and checkbox entries use the
 * `dayKey` stamped at write time. A running session counts up to `now`.
 */
export function dailyTotals(
  entries: Entry[],
  kind: TaskKind,
  cfg: DayConfig,
  now: Date | number = Date.now(),
): Map<string, number> {
  const totals = new Map<string, number>()
  const add = (key: string, value: number): void => {
    totals.set(key, (totals.get(key) ?? 0) + value)
  }

  for (const e of entries) {
    if (!live(e) || e.isSkip) continue
    if (kind === 'timer') {
      if (!e.startedAt) {
        // manual entry with no session: amount carries seconds
        if (e.amount) add(e.dayKey, e.amount)
        continue
      }
      const end = e.endedAt ?? new Date(typeof now === 'number' ? now : now.getTime()).toISOString()
      for (const s of splitSession(e.startedAt, end, cfg)) add(s.dayKey, s.seconds)
    } else {
      add(e.dayKey, e.amount)
    }
  }
  return totals
}

export function totalForDay(
  entries: Entry[],
  kind: TaskKind,
  dayKey: string,
  cfg: DayConfig,
  now: Date | number = Date.now(),
): number {
  return dailyTotals(entries, kind, cfg, now).get(dayKey) ?? 0
}

/** Days explicitly marked skipped. Skips are neutral, like unscheduled days. */
export function skippedDays(entries: Entry[]): Set<string> {
  const out = new Set<string>()
  for (const e of entries) if (live(e) && e.isSkip) out.add(e.dayKey)
  return out
}

/** Entries whose owner no longer exists. Surfaced in Settings, never deleted silently. */
export function orphanedEntries(entries: Entry[], knownIds: ReadonlySet<string>): Entry[] {
  return entries.filter((e) => live(e) && !knownIds.has(e.ownerId))
}
