/**
 * Side-by-side layout for day-plan blocks that overlap.
 *
 * `repack.ts` has always held that "overlaps are legal", but the canvas could not draw
 * them: it keyed blocks into a `Map<number, Block>` by start slot, so two blocks starting
 * in the same fifteen minutes meant the second replaced the first in the map and was
 * never rendered at all. A block that merely *overlapped* another fared no better — the
 * renderer jumped its cursor past the end of the first block and then skipped the second
 * as already-covered ground. Either way a block vanished from the plan with no warning.
 *
 * This turns a flat list into disjoint clusters of mutually overlapping blocks, each
 * block assigned a lane within its cluster, so the canvas can draw them as columns.
 * Everything here is grid-snapped, because the canvas is a grid of fifteen-minute slots
 * and a block half a slot out would render in the wrong row.
 */

import { BLOCK_GRANULARITY } from './repack'

interface BlockLike {
  id: string
  plannedStartMinute: number
  plannedMinutes: number
}

/** One block, snapped to the grid and given a column within its cluster. */
export interface Placed<T> {
  block: T
  startMinute: number
  minutes: number
  lane: number
}

/**
 * A run of blocks that overlap, directly or through a chain of others.
 *
 * Clusters never touch each other, so the canvas can lay them out one after another and
 * only has to think about lanes inside one.
 */
export interface Cluster<T> {
  startMinute: number
  minutes: number
  laneCount: number
  items: Placed<T>[]
}

const snap = (minute: number): number =>
  Math.round(minute / BLOCK_GRANULARITY) * BLOCK_GRANULARITY

/**
 * Group overlapping blocks into clusters and assign each one a lane.
 *
 * Returned in start order, each cluster's items in start order too. A block is never
 * dropped: every input appears in exactly one cluster.
 */
export function layoutBlocks<T extends BlockLike>(blocks: readonly T[]): Cluster<T>[] {
  const placed: Placed<T>[] = blocks
    .map((block) => ({
      block,
      startMinute: snap(block.plannedStartMinute),
      // a zero-length block would be invisible and would not advance the cursor
      minutes: Math.max(BLOCK_GRANULARITY, snap(block.plannedMinutes)),
      lane: 0,
    }))
    // longest first among equal starts, so the big block takes lane 0 and the short ones
    // stack to its right rather than the other way round
    .sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        b.minutes - a.minutes ||
        a.block.id.localeCompare(b.block.id),
    )

  const clusters: Cluster<T>[] = []
  let current: Placed<T>[] = []
  let reach = -1 // furthest end so far in the open cluster

  for (const item of placed) {
    // `>=` and not `>`: a block starting exactly where the last one ended abuts it
    // rather than overlapping, and belongs to its own cluster
    if (current.length > 0 && item.startMinute >= reach) {
      clusters.push(assignLanes(current))
      current = []
      reach = -1
    }
    current.push(item)
    reach = Math.max(reach, item.startMinute + item.minutes)
  }
  if (current.length > 0) clusters.push(assignLanes(current))

  return clusters
}

/**
 * Put each block in the leftmost lane that is free when it starts.
 *
 * Greedy and order-dependent, which is what makes it stable: the same blocks always
 * produce the same columns, so a block does not jump sideways when an unrelated one
 * elsewhere in the day is edited.
 */
function assignLanes<T>(items: Placed<T>[]): Cluster<T> {
  const laneEnds: number[] = []

  for (const item of items) {
    let lane = laneEnds.findIndex((end) => end <= item.startMinute)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = item.startMinute + item.minutes
    item.lane = lane
  }

  const startMinute = items[0]!.startMinute // sorted by start, so the first is earliest
  const end = Math.max(...items.map((i) => i.startMinute + i.minutes))
  return { startMinute, minutes: end - startMinute, laneCount: laneEnds.length, items }
}
