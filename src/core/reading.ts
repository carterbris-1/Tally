/**
 * Choosing the day's reading.
 *
 * Pure: it takes candidates someone else fetched and returns one of them. The `dayKey`
 * is the seed, so the same day and the same inputs always produce the same pick — which
 * is what stops the article changing every time you open the app, and what makes this
 * testable without a network.
 */

export type ReadKind = 'essay' | 'article' | 'paper'

export interface Candidate {
  kind: ReadKind
  title: string
  author: string
  url: string
  topic: string
  minutes: number
  year: number | null
  source: 'hn' | 'openalex' | 'crossref'
  /** Stable per item. What the 90-day window dedupes on. */
  sourceId: string
  /** A sentence or two of what it is, when the source gives us one. May be empty. */
  blurb: string
}

export const KIND_ROTATION: readonly ReadKind[] = ['essay', 'article', 'paper'] as const
export const DEDUPE_DAYS = 90

const dayNumber = (dayKey: string): number => {
  const [y, m, d] = dayKey.split('-').map(Number)
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000)
}

/**
 * Which shape of thing today is for.
 *
 * Driven by the absolute day number rather than a counter, so it is stable across
 * devices and reinstalls, and so picking three days in one pass gives three kinds.
 */
export function kindForDay(dayKey: string): ReadKind {
  const n = dayNumber(dayKey)
  return KIND_ROTATION[((n % KIND_ROTATION.length) + KIND_ROTATION.length) % KIND_ROTATION.length]!
}

/** Deterministic PRNG seeded from a string. Small, fast, good enough to shuffle with. */
function seeded(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SelectInput {
  candidates: readonly Candidate[]
  dayKey: string
  /** topic -> weight. 0 or absent means never. An empty map means no preference. */
  topics: Record<string, number>
  minutesMax: number
  /** Everything picked in the last DEDUPE_DAYS, plus anything already buffered ahead. */
  recentSourceIds: ReadonlySet<string>
}

const weightOf = (topics: Record<string, number>, topic: string): number => {
  if (Object.keys(topics).length === 0) return 1
  return topics[topic.toLocaleLowerCase()] ?? 0
}

/**
 * Pick one. Returns null only when there is genuinely nothing left to offer.
 *
 * Relaxes in a fixed order rather than failing: today's kind first, then any kind, then
 * ignoring the length budget. The 90-day dedupe is never relaxed — being offered the
 * same piece twice is worse than being offered a long one.
 */
export function selectPick(input: SelectInput): Candidate | null {
  const { candidates, dayKey, topics, minutesMax, recentSourceIds } = input
  const fresh = candidates.filter((c) => !recentSourceIds.has(c.sourceId) && weightOf(topics, c.topic) > 0)
  if (fresh.length === 0) return null

  const kind = kindForDay(dayKey)
  const pools = [
    fresh.filter((c) => c.kind === kind && c.minutes <= minutesMax),
    fresh.filter((c) => c.kind === kind),
    fresh.filter((c) => c.minutes <= minutesMax),
    fresh,
  ]
  const pool = pools.find((p) => p.length > 0)
  if (!pool) return null

  const rand = seeded(dayKey)()
  const total = pool.reduce((sum, c) => sum + weightOf(topics, c.topic), 0)
  let cursor = rand * total
  for (const c of pool) {
    cursor -= weightOf(topics, c.topic)
    if (cursor <= 0) return c
  }
  return pool[pool.length - 1]!
}

/** The topics offered in Settings. Deliberately short — a long list never gets tuned. */
export const TOPICS = [
  'philosophy',
  'history',
  'science',
  'technology',
  'economics',
  'psychology',
  'mathematics',
  'literature',
] as const

export const DEFAULT_TOPICS: Record<string, number> = Object.fromEntries(
  TOPICS.map((t) => [t, 1]),
)
