import { describe, expect, it } from 'vitest'
import { kindForDay, selectPick, type Candidate } from '../../src/core/reading'

const c = (over: Partial<Candidate> & Pick<Candidate, 'sourceId'>): Candidate => ({
  kind: 'essay',
  title: `Item ${over.sourceId}`,
  author: 'Someone',
  url: `https://example.com/${over.sourceId}`,
  topic: 'philosophy',
  minutes: 20,
  year: 2020,
  source: 'hn',
  blurb: '',
  ...over,
})

const base = {
  dayKey: '2026-09-12',
  topics: {} as Record<string, number>,
  minutesMax: 30,
  recentSourceIds: new Set<string>(),
}

describe('kindForDay', () => {
  it('rotates so consecutive days differ in shape', () => {
    const kinds = ['2026-09-12', '2026-09-13', '2026-09-14'].map(kindForDay)
    expect(new Set(kinds).size).toBe(3)
  })

  it('repeats every three days, and is stable for a given day', () => {
    expect(kindForDay('2026-09-12')).toBe(kindForDay('2026-09-15'))
    expect(kindForDay('2026-09-12')).toBe(kindForDay('2026-09-12'))
  })

  it('does not break on a day number that would go negative under a naive modulo', () => {
    expect(['essay', 'article', 'paper']).toContain(kindForDay('1969-12-30'))
  })
})

describe('selectPick', () => {
  const three = [
    c({ sourceId: 'e1', kind: 'essay' }),
    c({ sourceId: 'a1', kind: 'article', minutes: 8 }),
    c({ sourceId: 'p1', kind: 'paper', minutes: 45 }),
  ]

  it('is deterministic for a day', () => {
    const a = selectPick({ ...base, candidates: three })
    const b = selectPick({ ...base, candidates: three })
    expect(a?.sourceId).toBe(b?.sourceId)
  })

  it('prefers the kind the rotation asks for', () => {
    const kind = kindForDay('2026-09-12')
    expect(selectPick({ ...base, candidates: three })?.kind).toBe(kind)
  })

  it('gives three different items when three days are picked at once', () => {
    const pool = ['essay', 'article', 'paper'].flatMap((kind) =>
      [1, 2, 3].map((n) => c({ sourceId: `${kind}${n}`, kind: kind as Candidate['kind'], minutes: 10 })),
    )
    const picked = new Set<string>()
    for (const dayKey of ['2026-09-12', '2026-09-13', '2026-09-14']) {
      const pick = selectPick({ ...base, dayKey, candidates: pool, recentSourceIds: picked })
      expect(pick).not.toBeNull()
      picked.add(pick!.sourceId)
    }
    expect(picked.size).toBe(3)
  })

  it('never offers something inside the dedupe window', () => {
    const pick = selectPick({ ...base, candidates: three, recentSourceIds: new Set(['e1', 'a1', 'p1']) })
    expect(pick).toBeNull()
  })

  it('would rather break the length budget than repeat itself', () => {
    // only a long paper is left, and the budget is 30 minutes
    const pick = selectPick({
      ...base,
      candidates: [c({ sourceId: 'p9', kind: 'paper', minutes: 90 })],
      minutesMax: 30,
    })
    expect(pick?.sourceId).toBe('p9')
  })

  it('excludes a topic weighted to zero', () => {
    const pool = [
      c({ sourceId: 'x', topic: 'philosophy' }),
      c({ sourceId: 'y', topic: 'economics' }),
    ]
    const pick = selectPick({ ...base, candidates: pool, topics: { philosophy: 0, economics: 3 } })
    expect(pick?.sourceId).toBe('y')
  })

  it('returns null when every topic is switched off', () => {
    expect(selectPick({ ...base, candidates: three, topics: { philosophy: 0 } })).toBeNull()
  })

  it('treats an empty topic map as no preference rather than no topics', () => {
    expect(selectPick({ ...base, candidates: three, topics: {} })).not.toBeNull()
  })

  it('has nothing to say when there are no candidates', () => {
    expect(selectPick({ ...base, candidates: [] })).toBeNull()
  })

  it('spreads picks across the pool rather than always choosing the first', () => {
    const pool = Array.from({ length: 20 }, (_, i) => c({ sourceId: `e${i}`, kind: 'essay' }))
    const seen = new Set<string>()
    for (let d = 1; d <= 28; d += 1) {
      const dayKey = `2026-09-${String(d).padStart(2, '0')}`
      if (kindForDay(dayKey) !== 'essay') continue
      seen.add(selectPick({ ...base, dayKey, candidates: pool })!.sourceId)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
