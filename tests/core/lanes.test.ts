import { describe, expect, it } from 'vitest'
import { layoutBlocks } from '../../src/core/lanes'

const block = (id: string, start: number, minutes: number) => ({
  id,
  plannedStartMinute: start,
  plannedMinutes: minutes,
})

/** Every input block must come out somewhere. This is the property that was broken. */
const idsIn = (clusters: ReturnType<typeof layoutBlocks>): string[] =>
  clusters.flatMap((c) => c.items.map((i) => i.block.id)).sort()

describe('laying out day-plan blocks', () => {
  it('keeps two blocks that start in the same slot', () => {
    // the original bug: a Map keyed on start minute meant the second replaced the first
    const out = layoutBlocks([block('a', 600, 60), block('b', 600, 60)])
    expect(idsIn(out)).toEqual(['a', 'b'])
    expect(out).toHaveLength(1)
    expect(out[0]!.laneCount).toBe(2)
    expect(out[0]!.items.map((i) => i.lane).sort()).toEqual([0, 1])
  })

  it('keeps a block that merely overlaps another', () => {
    // the second half of the bug: the cursor jumped past 'a' and then skipped 'b' as
    // covered ground, so an overlapping block vanished just as completely
    const out = layoutBlocks([block('a', 600, 60), block('b', 630, 60)])
    expect(idsIn(out)).toEqual(['a', 'b'])
    expect(out).toHaveLength(1)
    expect(out[0]!.laneCount).toBe(2)
  })

  it('leaves blocks that do not overlap in separate clusters and one lane each', () => {
    const out = layoutBlocks([block('a', 600, 60), block('b', 720, 60)])
    expect(out).toHaveLength(2)
    expect(out.every((c) => c.laneCount === 1)).toBe(true)
  })

  it('treats a block starting exactly where another ends as abutting, not overlapping', () => {
    const out = layoutBlocks([block('a', 600, 60), block('b', 660, 60)])
    expect(out).toHaveLength(2)
  })

  it('chains a cluster through a middle block that touches both ends', () => {
    // a and c never overlap each other, but b overlaps both, so all three share a cluster
    const out = layoutBlocks([block('a', 600, 30), block('b', 615, 60), block('c', 660, 30)])
    expect(out).toHaveLength(1)
    expect(idsIn(out)).toEqual(['a', 'b', 'c'])
    expect(out[0]!.startMinute).toBe(600)
    expect(out[0]!.minutes).toBe(90) // 600 through 690
  })

  it('reuses a lane once it is free', () => {
    // a runs long in lane 0; b and c are short and sequential, so both fit lane 1
    const out = layoutBlocks([block('a', 600, 120), block('b', 600, 30), block('c', 645, 30)])
    expect(out).toHaveLength(1)
    expect(out[0]!.laneCount).toBe(2)
    const lane = (id: string) => out[0]!.items.find((i) => i.block.id === id)!.lane
    expect(lane('a')).toBe(0)
    expect(lane('b')).toBe(1)
    expect(lane('c')).toBe(1)
  })

  it('snaps to the grid so nothing renders in the wrong row', () => {
    // a real logged session starting at minute 607 and running 43 minutes rounds to the
    // nearest slot in each direction: 600, and 45 minutes long
    const out = layoutBlocks([block('a', 607, 43)])
    expect(out[0]!.items[0]!.startMinute).toBe(600)
    expect(out[0]!.items[0]!.minutes).toBe(45)
  })

  it('gives a zero-length block a visible slot rather than dropping it', () => {
    const out = layoutBlocks([block('a', 600, 0)])
    expect(out[0]!.items[0]!.minutes).toBe(15)
    expect(out[0]!.minutes).toBe(15)
  })

  it('is stable regardless of input order', () => {
    const forward = layoutBlocks([block('a', 600, 60), block('b', 615, 30), block('c', 630, 60)])
    const backward = layoutBlocks([block('c', 630, 60), block('b', 615, 30), block('a', 600, 60)])
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward))
  })

  it('returns nothing for no blocks', () => {
    expect(layoutBlocks([])).toEqual([])
  })

  it('never drops a block, whatever the arrangement', () => {
    const many = [
      block('a', 0, 60), block('b', 30, 15), block('c', 30, 240),
      block('d', 45, 15), block('e', 600, 60), block('f', 600, 60),
      block('g', 1380, 120), // runs past the end of the day
    ]
    expect(idsIn(layoutBlocks(many))).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })
})
