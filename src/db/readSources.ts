/**
 * Live candidate sources.
 *
 * Every endpoint here was checked to send `Access-Control-Allow-Origin`, which is the
 * only thing that matters for a static site. arXiv was in the spec and is not here: it
 * serves its XML happily to curl and sends no CORS header, so a browser blocks it.
 * Semantic Scholar rate-limits anonymous callers.
 *
 * Each adapter returns `[]` on any failure and never throws. A dead source must degrade
 * the pool, not the feature.
 *
 * On why the queries look the way they do — the first cut asked each API for the bare
 * subject word ("philosophy", "science") and took whatever ranked highest. That reliably
 * produced the dullest corner of the literature:
 *
 *   - OpenAlex sorted by citations returns *tools*, not ideas. The most-cited "science"
 *     papers are SHELX, ImageJ, lme4, G*Power — software everyone cites and nobody reads.
 *   - Its full-text `search` matches the word anywhere, so "philosophy" returned
 *     crystallography packages that happen to contain the word.
 *   - Crossref's default relevance answered "free will" with "Acute Atraumatic Thumb Pain".
 *   - HN's corpus is tech, so "philosophy" meant the Unix philosophy, every time.
 *
 * So subjects now expand into curated OpenAlex *topic ids* and concrete search phrases
 * instead of one generic word. Sorting by citations inside a narrow topic is the opposite
 * of sorting by citations across everything: it surfaces the landmark, not the toolchain.
 */

import type { Candidate, ReadKind } from '../core/reading'

const TIMEOUT_MS = 4000

/**
 * OpenAlex gives the polite pool faster, more reliable service when you identify.
 *
 * Anonymous requests also draw on a daily budget shared by everyone on your IP, and when
 * it runs out the API answers 429 until midnight UTC. One person browsing will never
 * notice; a shared network might. `VITE_OPENALEX_KEY` is optional and free, and lifts it.
 */
const MAILTO = 'tally-reader@users.noreply.github.com'
const OPENALEX_KEY = (import.meta.env.VITE_OPENALEX_KEY as string | undefined) ?? ''

/** Rough reading time by shape. None of these APIs report length. */
const MINUTES: Record<ReadKind, number> = { essay: 20, article: 8, paper: 45 }

/**
 * What each subject actually means to each API.
 *
 * `openAlex` are topic ids (from /topics), hand-checked by reading the top works each one
 * returns. Topics whose top hits were methodology, datasets or misfiled scans were cut —
 * OpenAlex's classifier puts a surprising amount of 1930s biochemistry under archaeology.
 *
 * `hn` and `crossref` are phrases rather than subject words, because both engines rank on
 * term overlap and a single abstract noun overlaps with everything.
 *
 * Several `hn` phrases carry a word they would not otherwise need — "human memory",
 * "literary translation", "particle physics" — because the bare noun is a homonym on a
 * tech forum. Unqualified, "memory" is a memory leak, "translation" is a macOS
 * compatibility layer, and "evolution" is someone's codebase. The extra word is the fix.
 */
interface Subject {
  openAlex: readonly string[]
  hn: readonly string[]
  crossref: readonly string[]
}

const SUBJECTS: Record<string, Subject> = {
  philosophy: {
    openAlex: ['T10297', 'T12558', 'T11997', 'T10258', 'T14092', 'T10778'],
    hn: ['consciousness', 'stoicism', 'free will', 'philosophy of mind', 'epistemology', 'moral philosophy', 'existentialism'],
    crossref: ['free will moral responsibility', 'personal identity over time', 'the hard problem of consciousness', 'virtue ethics', 'knowledge and justified belief'],
  },
  history: {
    openAlex: ['T10595', 'T13372', 'T11104', 'T13922', 'T12409', 'T12323', 'T10165'],
    hn: ['ancient rome', 'medieval', 'archaeology', 'ancient greece', 'industrial revolution', 'roman empire', 'shipwreck'],
    crossref: ['collapse of complex societies', 'memory and commemoration', 'everyday life in medieval europe', 'the printing press and society', 'trade routes antiquity'],
  },
  science: {
    openAlex: ['T11445', 'T10778', 'T11244', 'T10439', 'T12448', 'T13558', 'T10174', 'T11913'],
    hn: ['neuroscience', 'astronomy', 'genetics', 'origin of life', 'animal behavior', 'particle physics', 'natural selection'],
    crossref: ['origin of life on earth', 'animal cognition and intelligence', 'the replication crisis', 'extinction and biodiversity loss', 'scientific explanation'],
  },
  technology: {
    openAlex: ['T10883', 'T10237', 'T10020', 'T11675', 'T12423', 'T11045', 'T14288', 'T14493', 'T10470', 'T12797'],
    hn: ['cryptography', 'operating system', 'compiler', 'distributed systems', 'history of computing', 'programming language', 'open source'],
    crossref: ['ethics of artificial intelligence', 'privacy and surveillance', 'open source collaboration', 'software failure case study', 'human computer interaction'],
  },
  economics: {
    openAlex: ['T10315', 'T10646', 'T10785', 'T11031', 'T10991', 'T11014', 'T10208', 'T10349', 'T12088', 'T11743'],
    hn: ['economics', 'inflation', 'game theory', 'income inequality', 'housing market', 'labor market', 'central bank'],
    crossref: ['bounded rationality decision making', 'income inequality trends', 'the nature of the firm', 'cooperation and fairness experiments', 'economic growth institutions'],
  },
  psychology: {
    openAlex: ['T10918', 'T10042', 'T11040', 'T12520', 'T10853', 'T11079', 'T11997'],
    hn: ['human memory', 'cognitive bias', 'sleep research', 'attention span', 'habit formation', 'psychology study', 'personality traits'],
    crossref: ['cognitive biases in judgment', 'how memory is reconstructed', 'moral judgment and emotion', 'attention and distraction', 'rumination and depression'],
  },
  mathematics: {
    openAlex: ['T11166', 'T10304', 'T10622', 'T12170', 'T10061', 'T11428'],
    hn: ['mathematics', 'mathematical proof', 'number theory', 'prime numbers', 'probability', 'geometry'],
    crossref: ['history of mathematical notation', 'foundations of set theory', 'prime number distribution', 'knot theory invariants', 'probability paradoxes'],
  },
  literature: {
    openAlex: ['T12912', 'T12398', 'T12974', 'T12461', 'T10759', 'T13704'],
    hn: ['literature', 'poetry', 'shakespeare', 'literary translation', 'fiction writing', 'novelist'],
    crossref: ['narrative theory and poetics', 'the rise of the novel', 'literary translation problems', 'modernism and the reader', 'why we read fiction'],
  },
}

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null // offline, timed out, blocked, malformed — all the same to the caller
  } finally {
    clearTimeout(timer)
  }
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Deterministic, so the same day asks the same questions and the buffer stays stable. */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The most any single query may contribute.
 *
 * Crossref answers a narrow phrase with twenty near-identical papers — a search for virtue
 * ethics returns "Kant's Virtue Ethics", "Contemporary virtue ethics", "Applying Virtue to
 * Ethics" and so on. Left alone they crowd out every other query and you get a week of the
 * same subject, so each query gets a quota rather than as much room as it can fill.
 */
const PER_QUERY_CAP = 6

/** `count` entries from `list`, starting at a seeded offset. Rotates the pool over time. */
function rotate<T>(list: readonly T[], seed: string, count: number): T[] {
  if (list.length === 0) return []
  const start = hash(seed) % list.length
  return Array.from({ length: Math.min(count, list.length) }, (_, i) => list[(start + i) % list.length]!)
}

/**
 * Titles that are not things to read.
 *
 * Old scanned journals enter these corpora as all-caps stubs ("THE COAGULATION OF ALBUMEN
 * BY PRESSURE") or as the journal's own name standing in for an article ("The
 * Philosophical Quarterly", "Archivum Fratrum Praedicatorum"). Both slip past every
 * server-side filter because they are genuinely well-cited.
 */
const JOURNALISH = /^(transactions|proceedings|verhandlungen|archivum|annales|bulletin|zeitschrift|journal|revue|the\s+\w+\s+(quarterly|review|journal))\b/i

function readable(title: string): boolean {
  if (title.length < 15) return false
  if (JOURNALISH.test(title)) return false
  // all-caps is a scan artefact, not emphasis
  const letters = title.replace(/[^A-Za-z]/g, '')
  if (letters.length > 12 && letters === letters.toUpperCase()) return false
  return true
}

const BLURB_MAX = 240

function trim(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= BLURB_MAX ? flat : `${flat.slice(0, BLURB_MAX - 3).trimEnd()}…`
}

/** OpenAlex ships abstracts as a word -> positions map. Put it back in order. */
function inflateAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return ''
  const at: string[] = []
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) at[p] = word
  }
  return trim(at.join(' '))
}

/**
 * Crossref ships abstracts as a fragment of JATS XML, sometimes with an "Abstract"
 * heading of its own. Strip the tags and that redundant first word.
 */
function stripJats(raw: string | undefined): string {
  if (!raw) return ''
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^\s*abstract[:.\s]*/i, '')
  return trim(text)
}

// ------------------------------------------------------------------ HN

interface HnHit {
  objectID?: string
  title?: string
  url?: string | null
  author?: string
  points?: number
  created_at?: string
}

/**
 * Essays and articles from Hacker News.
 *
 * HN does not label essays, so age and endorsement stand in for it: something with 200+
 * points that people still link to years later is an essay; something from last month is
 * an article. Crude, but it separates "this endured" from "this is news", which is the
 * distinction the rotation is actually for.
 *
 * The title guard is not optional. Algolia loosens to OR-matching when a phrase is rare,
 * so "stoicism" came back with an AI image upscaler — a genuinely popular story that
 * shares no subject with the query. Requiring *every* word of the phrase, not just one,
 * is what makes the multi-word queries work: HN is a tech site, so "translation" alone
 * returns Firefox Translations and a macOS compatibility layer, and only insisting on
 * "literary" as well gets rid of them.
 */
export async function fetchHn(subject: string, seed: string, now = Date.now()): Promise<Candidate[]> {
  const queries = rotate(SUBJECTS[subject]?.hn ?? [subject], seed, 3)
  const out: Candidate[] = []
  const twoYears = 2 * 365 * 86_400_000

  for (const query of queries) {
    const url =
      `https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(query)}` +
      `&hitsPerPage=40&numericFilters=points%3E150`
    const data = await getJson<{ hits?: HnHit[] }>(url)
    if (!data?.hits) continue

    const terms = query.toLocaleLowerCase().split(/\s+/).filter((t) => t.length > 3)
    let taken = 0
    for (const hit of data.hits) {
      if (taken >= PER_QUERY_CAP) break
      const link = clean(hit.url)
      const title = clean(hit.title)
      const id = clean(hit.objectID)
      if (!link || !title || !id) continue // Ask HN and friends have no link to read
      if (!readable(title)) continue
      const haystack = `${title} ${link}`.toLocaleLowerCase()
      if (!terms.every((t) => haystack.includes(t))) continue

      const created = Date.parse(clean(hit.created_at))
      const age = Number.isFinite(created) ? now - created : 0
      const kind: ReadKind = (hit.points ?? 0) >= 250 && age > twoYears ? 'essay' : 'article'
      out.push({
        kind,
        title,
        author: clean(hit.author) || 'Unknown',
        url: link,
        topic: subject,
        minutes: MINUTES[kind],
        year: Number.isFinite(created) ? new Date(created).getUTCFullYear() : null,
        source: 'hn',
        sourceId: `hn:${id}`,
        blurb: '',
      })
      taken += 1
    }
  }
  return out
}

// ------------------------------------------------------------ OpenAlex

interface OaWork {
  id?: string
  title?: string
  publication_year?: number
  cited_by_count?: number
  abstract_inverted_index?: Record<string, number[]> | null
  best_oa_location?: { landing_page_url?: string | null } | null
  authorships?: Array<{ author?: { display_name?: string } }>
}

/**
 * Open-access papers, drawn from curated topics rather than a text search.
 *
 * `has_abstract` and `language:en` do most of the cleaning: between them they remove the
 * misfiled scans and the untranslated European back-catalogue that otherwise dominate the
 * humanities topics. A citation floor removes the merely obscure.
 *
 * There is deliberately no `primary_topic.score` threshold. It looks like the obvious
 * filter and it is a trap: in the humanities OpenAlex scores correctly-classified classics
 * very low — McTaggart's "The Unreality of Time" sits at 0.13, "Two Distinctions in
 * Goodness" at 0.01 — so a threshold that removes the junk removes the best of the pool
 * with it.
 */
export async function fetchOpenAlex(subject: string, seed: string): Promise<Candidate[]> {
  const topics = rotate(SUBJECTS[subject]?.openAlex ?? [], seed, 2)
  if (topics.length === 0) return []
  // walk deeper into each topic over time, so the pool is not the same ten papers forever
  const page = 1 + (hash(`${seed}:page`) % 3)
  const out: Candidate[] = []

  for (const topicId of topics) {
    const url =
      `https://api.openalex.org/works?filter=is_oa:true,type:article,has_abstract:true,` +
      `language:en,primary_topic.id:${topicId},cited_by_count:>40` +
      `&sort=cited_by_count:desc&per-page=25&page=${page}` +
      `&select=id,title,publication_year,cited_by_count,abstract_inverted_index,best_oa_location,authorships` +
      `&mailto=${encodeURIComponent(MAILTO)}` +
      (OPENALEX_KEY ? `&api_key=${encodeURIComponent(OPENALEX_KEY)}` : '')
    const data = await getJson<{ results?: OaWork[] }>(url)
    if (!data?.results) continue

    let taken = 0
    for (const w of data.results) {
      if (taken >= PER_QUERY_CAP) break
      const link = clean(w.best_oa_location?.landing_page_url)
      const title = clean(w.title)
      const id = clean(w.id)
      if (!link || !title || !id) continue
      if (!readable(title)) continue
      out.push({
        kind: 'paper',
        title,
        author: clean(w.authorships?.[0]?.author?.display_name) || 'Unknown',
        url: link,
        topic: subject,
        minutes: MINUTES.paper,
        year: typeof w.publication_year === 'number' ? w.publication_year : null,
        source: 'openalex',
        sourceId: `oa:${id}`,
        blurb: inflateAbstract(w.abstract_inverted_index),
      })
      taken += 1
    }
  }
  return out
}

// ------------------------------------------------------------ Crossref

interface CrItem {
  DOI?: string
  title?: string[]
  URL?: string
  author?: Array<{ given?: string; family?: string }>
  issued?: { 'date-parts'?: number[][] }
  abstract?: string
  'is-referenced-by-count'?: number
}

/**
 * A second paper source, so OpenAlex going quiet does not empty the paper rotation.
 *
 * `query.title` rather than the general `query`: Crossref's default relevance searches
 * every field including affiliations and journal names, which is how a search for "free
 * will" returned a paper on thumb pain. Titles only, and a citation floor, keeps it
 * roughly honest.
 */
export async function fetchCrossref(subject: string, seed: string): Promise<Candidate[]> {
  const queries = rotate(SUBJECTS[subject]?.crossref ?? [subject], seed, 2)
  const out: Candidate[] = []

  for (const query of queries) {
    const url =
      `https://api.crossref.org/works?query.title=${encodeURIComponent(query)}` +
      `&rows=25&filter=type:journal-article,has-abstract:true` +
      `&select=DOI,title,author,issued,URL,abstract,is-referenced-by-count`
    const data = await getJson<{ message?: { items?: CrItem[] } }>(url)
    const items = data?.message?.items
    if (!items) continue

    let taken = 0
    for (const it of items) {
      if (taken >= PER_QUERY_CAP) break
      const title = clean(it.title?.[0])
      const doi = clean(it.DOI)
      const link = clean(it.URL) || (doi ? `https://doi.org/${doi}` : '')
      if (!title || !doi || !link) continue
      if (!readable(title)) continue
      if ((it['is-referenced-by-count'] ?? 0) < 10) continue // uncited here means unread
      const a = it.author?.[0]
      out.push({
        kind: 'paper',
        title,
        author: [clean(a?.given), clean(a?.family)].filter(Boolean).join(' ') || 'Unknown',
        url: link,
        topic: subject,
        minutes: MINUTES.paper,
        year: it.issued?.['date-parts']?.[0]?.[0] ?? null,
        source: 'crossref',
        sourceId: `cr:${doi}`,
        blurb: stripJats(it.abstract),
      })
      taken += 1
    }
  }
  return out
}

/**
 * How many of the enabled subjects one fill actually asks about.
 *
 * A fill only needs to choose three days of reading, and each subject costs seven
 * requests across the three APIs. Asking about all eight every time meant sixty-odd
 * requests to pick three things, which is how OpenAlex's anonymous daily budget gets
 * spent. A rotating handful gives the same variety over a week for a third of the
 * traffic — a different few subjects come up each day rather than all of them at once.
 */
const SUBJECTS_PER_FILL = 4

/**
 * Everything, for a handful of subjects, in parallel.
 *
 * `allSettled` rather than `all`: one source failing must not take the others with it,
 * and the adapters already swallow their own errors. `seed` is the day key, so the set of
 * subjects, topics and phrases asked for is stable within a day and drifts across days.
 */
export async function fetchCandidates(
  subjects: readonly string[],
  seed = '',
  now = Date.now(),
): Promise<Candidate[]> {
  const chosen = rotate(subjects, seed, SUBJECTS_PER_FILL)
  const jobs = chosen.flatMap((s) => [
    fetchHn(s, `${seed}:${s}`, now),
    fetchOpenAlex(s, `${seed}:${s}`),
    fetchCrossref(s, `${seed}:${s}`),
  ])
  const settled = await Promise.allSettled(jobs)
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const cand of r.value) {
      if (seen.has(cand.sourceId)) continue // the same story can match two subjects
      seen.add(cand.sourceId)
      out.push(cand)
    }
  }
  return out
}
