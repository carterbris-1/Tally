/** Weighted project progress. */

interface PhaseLike {
  estimatedHours: number
  completedAt: string | null
  sortOrder: number
}

/**
 * Progress weighted by estimate, not by phase count.
 *
 * A 20h phase and a 2h phase is 91% done when the first finishes, not 50%.
 * Count-weighted bars lie exactly when the work is lumpiest.
 *
 * All-zero estimates fall back to count-weighting rather than dividing by zero.
 */
export function weightedProgress(phases: readonly PhaseLike[]): number {
  if (phases.length === 0) return 0

  const totalHours = phases.reduce((sum, p) => sum + Math.max(0, p.estimatedHours), 0)
  if (totalHours <= 0) {
    const done = phases.filter((p) => p.completedAt !== null).length
    return done / phases.length
  }

  const doneHours = phases
    .filter((p) => p.completedAt !== null)
    .reduce((sum, p) => sum + Math.max(0, p.estimatedHours), 0)
  return doneHours / totalHours
}

/** For display only. Phases complete in any order; this is not a gate. */
export function currentPhase<T extends PhaseLike>(phases: readonly T[]): T | null {
  const ordered = [...phases].sort((a, b) => a.sortOrder - b.sortOrder)
  return ordered.find((p) => p.completedAt === null) ?? null
}
