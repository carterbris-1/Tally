import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCrossref, fetchHn, fetchOpenAlex } from '../../src/db/readSources'

/**
 * These lock down the filtering, not the wording of any particular query.
 *
 * Each source was returning things nobody would read — HN answering a philosophy query
 * with an image upscaler, OpenAlex answering one with 1930s biochemistry. The guards that
 * fixed that are easy to weaken by accident later, so they get tests; the phrase lists
 * they operate on are expected to keep changing and are not asserted on.
 */

// takes the url so the call log is typed, and so tests can assert on what was requested
const ok = (body: unknown) =>
  vi.fn(async (_url: string) => ({ ok: true, json: async () => body }) as unknown as Response)

const hit = (over: Record<string, unknown> = {}) => ({
  objectID: 'a1',
  title: 'A Perfectly Reasonable Title About Things',
  url: 'https://example.com/a1',
  author: 'pg',
  points: 900,
  created_at: '2015-01-01T00:00:00Z',
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('HN candidates', () => {
  it('drops popular stories that have nothing to do with the query', async () => {
    // Algolia falls back to OR-matching on rare phrases, so a search for a philosophy
    // term comes back with whatever is popular that week.
    vi.stubGlobal('fetch', ok({
      hits: [
        hit({ objectID: 'keep', title: 'Stoicism: indifference is a power' }),
        hit({ objectID: 'drop', title: 'Upscayl – Free and Open Source AI Image Upscaler' }),
      ],
    }))
    const out = await fetchHn('philosophy', 'seed')
    expect(out.map((c) => c.sourceId)).toContain('hn:keep')
    expect(out.map((c) => c.sourceId)).not.toContain('hn:drop')
  })

  it('requires every word of a phrase, which is what disambiguates a homonym', async () => {
    // "literary translation" exists precisely so that HN's endless supply of
    // translation *layers* does not answer a question about books.
    vi.stubGlobal('fetch', ok({
      hits: [
        hit({ objectID: 'layer', title: 'Darling – macOS translation layer for Linux' }),
        hit({ objectID: 'books', title: 'The literary translation of Proust, revisited' }),
      ],
    }))
    const out = await fetchHn('literature', 'seed')
    const ids = out.map((c) => c.sourceId)
    expect(ids).not.toContain('hn:layer')
    // whichever phrase the rotation picked, a tech layer is never the answer
    if (ids.length > 0) expect(ids).toContain('hn:books')
  })

  it('skips posts with no link to read', async () => {
    vi.stubGlobal('fetch', ok({ hits: [hit({ url: null, title: 'Ask HN: consciousness?' })] }))
    expect(await fetchHn('philosophy', 'seed')).toHaveLength(0)
  })

  it('lets no single query flood the pool', async () => {
    vi.stubGlobal('fetch', ok({
      hits: Array.from({ length: 40 }, (_, i) =>
        hit({ objectID: `h${i}`, title: `Consciousness and its discontents, part ${i}` })),
    }))
    const out = await fetchHn('philosophy', 'seed')
    // three queries are issued; none may contribute more than its quota
    expect(out.length).toBeLessThanOrEqual(3 * 6)
  })
})

describe('OpenAlex candidates', () => {
  const work = (over: Record<string, unknown> = {}) => ({
    id: 'https://openalex.org/W1',
    title: 'The Structure of Scientific Revolutions Revisited',
    publication_year: 1990,
    cited_by_count: 400,
    abstract_inverted_index: { A: [0], short: [1], abstract: [2] },
    best_oa_location: { landing_page_url: 'https://example.org/w1' },
    authorships: [{ author: { display_name: 'T. Kuhn' } }],
    ...over,
  })

  it('rebuilds the abstract from the inverted index', async () => {
    vi.stubGlobal('fetch', ok({ results: [work()] }))
    const out = await fetchOpenAlex('philosophy', 'seed')
    expect(out[0]!.blurb).toBe('A short abstract')
  })

  it('drops all-caps scan artefacts and bare journal names', async () => {
    vi.stubGlobal('fetch', ok({
      results: [
        work({ id: 'https://openalex.org/Wjunk', title: 'THE COAGULATION OF ALBUMEN BY PRESSURE' }),
        work({ id: 'https://openalex.org/Wname', title: 'The Philosophical Quarterly' }),
        work({ id: 'https://openalex.org/Wgood', title: 'Why Isn’t There More Progress in Philosophy?' }),
      ],
    }))
    const out = await fetchOpenAlex('philosophy', 'seed')
    // several topics are queried and the stub answers them all alike; deduping is
    // fetchCandidates' job, so compare the distinct titles
    expect([...new Set(out.map((c) => c.title))]).toEqual(['Why Isn’t There More Progress in Philosophy?'])
  })

  it('asks for open access, English, and an abstract', async () => {
    const spy = ok({ results: [] })
    vi.stubGlobal('fetch', spy)
    await fetchOpenAlex('philosophy', 'seed')
    const url = String(spy.mock.calls[0]?.[0] ?? '')
    expect(url).toContain('is_oa:true')
    expect(url).toContain('language:en')
    expect(url).toContain('has_abstract:true')
    // sorted inside a narrow topic, where most-cited means landmark rather than toolchain
    expect(url).toContain('primary_topic.id:')
    expect(url).toContain('sort=cited_by_count:desc')
  })

  it('returns nothing rather than throwing when the API refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 }) as unknown as Response))
    await expect(fetchOpenAlex('philosophy', 'seed')).resolves.toEqual([])
  })
})

describe('Crossref candidates', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    DOI: '10.1/abc',
    title: ['Free Will and Moral Responsibility Reconsidered'],
    URL: 'https://doi.org/10.1/abc',
    author: [{ given: 'Ada', family: 'Lovelace' }],
    issued: { 'date-parts': [[2004]] },
    'is-referenced-by-count': 80,
    ...over,
  })

  it('searches titles, not every field', async () => {
    // the general `query` param matches affiliations and journal names too, which is how
    // a search for free will once returned a paper on thumb pain
    const spy = ok({ message: { items: [] } })
    vi.stubGlobal('fetch', spy)
    await fetchCrossref('philosophy', 'seed')
    expect(String(spy.mock.calls[0]?.[0] ?? '')).toContain('query.title=')
  })

  it('turns the JATS abstract into a plain blurb', async () => {
    vi.stubGlobal('fetch', ok({
      message: {
        items: [item({ abstract: '<jats:p>Abstract: We argue that  free will survives.</jats:p>' })],
      },
    }))
    const out = await fetchCrossref('philosophy', 'seed')
    expect(out[0]!.blurb).toBe('We argue that free will survives.')
  })

  it('drops the uncited, which here means unread', async () => {
    vi.stubGlobal('fetch', ok({
      message: {
        items: [
          item({ DOI: '10.1/keep' }),
          item({ DOI: '10.1/drop', 'is-referenced-by-count': 0 }),
        ],
      },
    }))
    const out = await fetchCrossref('philosophy', 'seed')
    expect([...new Set(out.map((c) => c.sourceId))]).toEqual(['cr:10.1/keep'])
  })
})
