/** Day-plan block layout. */

export const MINUTES_PER_DAY = 1440
export const BLOCK_GRANULARITY = 15

interface BlockLike {
  id: string
  plannedStartMinute: number
  plannedMinutes: number
  sortOrder: number
}

export function inSortOrder<T extends BlockLike>(blocks: readonly T[]): T[] {
  return [...blocks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
}

export function plannedEndMinute(b: BlockLike): number {
  return b.plannedStartMinute + b.plannedMinutes
}

/**
 * Chain every block after `fromId` onto the one before it, in sort order.
 *
 * It never reorders, never changes durations, and never touches blocks at or before
 * `fromId`. Predictability is the whole value: without it, inserting a block means
 * retyping four start times; with it that would be an undoable single action.
 *
 * Returns only the blocks whose start actually moved.
 */
export function repack<T extends BlockLike>(blocks: readonly T[], fromId: string): T[] {
  const ordered = inSortOrder(blocks)
  const startIndex = ordered.findIndex((b) => b.id === fromId)
  if (startIndex === -1) return []

  const changed: T[] = []
  let cursor = plannedEndMinute(ordered[startIndex]!)
  for (let i = startIndex + 1; i < ordered.length; i += 1) {
    const b = ordered[i]!
    if (b.plannedStartMinute !== cursor) changed.push({ ...b, plannedStartMinute: cursor })
    cursor += b.plannedMinutes
  }
  return changed
}

/**
 * Planned overflow is rejected at save; actual time is never clamped, because a block
 * worked past the day boundary is split by the same function that splits task timers.
 */
export function isPlannedWithinDay(b: Pick<BlockLike, 'plannedStartMinute' | 'plannedMinutes'>): boolean {
  return b.plannedStartMinute >= 0 && b.plannedStartMinute <= MINUTES_PER_DAY
}

export interface Overlap {
  earlier: string
  later: string
}

/** Overlaps are legal and rendered with a warning stripe. This is a plan, not a calendar. */
export function findOverlaps<T extends BlockLike>(blocks: readonly T[]): Overlap[] {
  const ordered = [...blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)
  const out: Overlap[] = []
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]!
    const cur = ordered[i]!
    if (cur.plannedStartMinute < plannedEndMinute(prev)) out.push({ earlier: prev.id, later: cur.id })
  }
  return out
}

/** Unplanned time between blocks, rendered as gaps. */
export function findGaps<T extends BlockLike>(blocks: readonly T[]): Array<{ startMinute: number; minutes: number }> {
  const ordered = [...blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)
  const out: Array<{ startMinute: number; minutes: number }> = []
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]!
    const cur = ordered[i]!
    const gap = cur.plannedStartMinute - plannedEndMinute(prev)
    if (gap > 0) out.push({ startMinute: plannedEndMinute(prev), minutes: gap })
  }
  return out
}

/** Signed variance in minutes: positive means over plan. */
export function variance(actualSeconds: number, plannedMinutes: number): number {
  return Math.round(actualSeconds / 60) - plannedMinutes
}

export function formatVariance(minutes: number): string {
  if (minutes === 0) return 'on plan'
  const sign = minutes > 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return h > 0 ? `${sign}${h}h ${m}m` : `${sign}${m}m`
}
