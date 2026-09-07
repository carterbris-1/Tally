import { describe, expect, it } from 'vitest'
import {
  findGaps,
  findOverlaps,
  formatVariance,
  isPlannedWithinDay,
  repack,
  variance,
} from '../../src/core/repack'

const block = (id: string, plannedStartMinute: number, plannedMinutes: number, sortOrder: number) => ({
  id,
  plannedStartMinute,
  plannedMinutes,
  sortOrder,
})

/** Five contiguous 60-minute blocks starting at the day start. */
const five = [
  block('a', 0, 60, 0),
  block('b', 60, 60, 1),
  block('c', 120, 60, 2),
  block('d', 180, 60, 3),
  block('e', 240, 60, 4),
]

describe('repack — the test the spec asked for', () => {
  it('shifts exactly the blocks after an inserted one', () => {
    // insert a 30-minute block at position 2, pushing b-e down the sort order
    const withInsert = [
      five[0]!,
      block('x', 60, 30, 1),
      ...five.slice(1).map((b, i) => ({ ...b, sortOrder: i + 2 })),
    ]
    const changed = repack(withInsert, 'x')

    expect(changed.map((b) => b.id)).toEqual(['b', 'c', 'd', 'e'])
    expect(changed.map((b) => b.plannedStartMinute)).toEqual([90, 150, 210, 270])
  })

  it('never touches blocks at or before the repack point', () => {
    const changed = repack(five, 'c')
    expect(changed.map((b) => b.id)).toEqual([]) // already contiguous
    const shifted = repack([...five.slice(0, 2), block('c', 120, 90, 2), ...five.slice(3)], 'c')
    expect(shifted.map((b) => b.id)).toEqual(['d', 'e'])
    expect(shifted.map((b) => b.plannedStartMinute)).toEqual([210, 270])
  })

  it('never reorders and never changes durations', () => {
    const scrambled = [block('a', 0, 45, 0), block('b', 500, 90, 1), block('c', 200, 30, 2)]
    const changed = repack(scrambled, 'a')
    expect(changed.map((b) => b.id)).toEqual(['b', 'c'])
    expect(changed.map((b) => b.plannedMinutes)).toEqual([90, 30])
    expect(changed.map((b) => b.sortOrder)).toEqual([1, 2])
    expect(changed.map((b) => b.plannedStartMinute)).toEqual([45, 135])
  })

  it('returns only the moved blocks, so one undo can restore them', () => {
    const changed = repack(five, 'a')
    expect(changed).toEqual([])
  })

  it('is a no-op for an unknown block', () => {
    expect(repack(five, 'nope')).toEqual([])
  })
})

describe('planned overflow', () => {
  it('rejects a block planned past the end of the day', () => {
    expect(isPlannedWithinDay({ plannedStartMinute: 1440, plannedMinutes: 30 })).toBe(true)
    expect(isPlannedWithinDay({ plannedStartMinute: 1441, plannedMinutes: 30 })).toBe(false)
    expect(isPlannedWithinDay({ plannedStartMinute: -1, plannedMinutes: 30 })).toBe(false)
  })
})

describe('gaps and overlaps', () => {
  it('finds unplanned time between blocks', () => {
    const gaps = findGaps([block('a', 0, 60, 0), block('b', 90, 60, 1)])
    expect(gaps).toEqual([{ startMinute: 60, minutes: 30 }])
  })

  it('flags overlaps rather than resolving them', () => {
    const overlaps = findOverlaps([block('a', 0, 60, 0), block('b', 30, 60, 1)])
    expect(overlaps).toEqual([{ earlier: 'a', later: 'b' }])
    expect(findOverlaps(five)).toEqual([])
  })
})

describe('variance', () => {
  it('is signed, positive meaning over plan', () => {
    expect(variance(95 * 60, 60)).toBe(35)
    expect(variance(0, 60)).toBe(-60)
    expect(variance(60 * 60, 60)).toBe(0)
  })

  it('formats the way the spec writes it', () => {
    expect(formatVariance(35)).toBe('+35m')
    expect(formatVariance(-70)).toBe('−1h 10m')
    expect(formatVariance(0)).toBe('on plan')
  })
})
