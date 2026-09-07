import { describe, expect, it } from 'vitest'
import { currentPhase, weightedProgress } from '../../src/core/progress'

const phase = (estimatedHours: number, done: boolean, sortOrder: number) => ({
  estimatedHours,
  completedAt: done ? '2026-09-01T12:00:00.000Z' : null,
  sortOrder,
})

describe('weightedProgress — the test the spec asked for', () => {
  it('reports 91% for a finished 20h phase beside an unfinished 2h one', () => {
    const p = weightedProgress([phase(20, true, 0), phase(2, false, 1)])
    expect(Math.round(p * 100)).toBe(91)
  })

  it('does not lie the way a count-weighted bar would', () => {
    // count-weighting would say 50% here
    expect(weightedProgress([phase(20, true, 0), phase(2, false, 1)])).toBeGreaterThan(0.9)
    // ...and 50% here too, when it is actually 9%
    expect(Math.round(weightedProgress([phase(2, true, 0), phase(20, false, 1)]) * 100)).toBe(9)
  })

  it('falls back to count-weighting instead of dividing by zero', () => {
    expect(weightedProgress([phase(0, true, 0), phase(0, false, 1)])).toBe(0.5)
    expect(weightedProgress([phase(0, true, 0), phase(0, true, 1), phase(0, false, 2)])).toBeCloseTo(2 / 3)
  })

  it('handles the empty and fully complete cases', () => {
    expect(weightedProgress([])).toBe(0)
    expect(weightedProgress([phase(5, true, 0), phase(5, true, 1)])).toBe(1)
  })

  it('ignores negative estimates rather than letting them subtract progress', () => {
    expect(weightedProgress([phase(-5, false, 0), phase(10, true, 1)])).toBe(1)
  })
})

describe('currentPhase', () => {
  it('is the first incomplete phase in sort order, not a gate', () => {
    const phases = [phase(1, true, 0), phase(1, false, 1), phase(1, false, 2)]
    expect(currentPhase(phases)?.sortOrder).toBe(1)
  })

  it('copes with phases completed out of order', () => {
    // phase 3 finished before phase 2; phase 2 is still what is current
    const phases = [phase(1, true, 0), phase(1, false, 1), phase(1, true, 2)]
    expect(currentPhase(phases)?.sortOrder).toBe(1)
  })

  it('is null when everything is done', () => {
    expect(currentPhase([phase(1, true, 0)])).toBeNull()
  })
})
