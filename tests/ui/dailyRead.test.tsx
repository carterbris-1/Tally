// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/App'
import { store } from '../../src/db/store'
import { clearAll } from '../../src/db/idb'

const hnHit = (id: string, title: string) => ({
  objectID: id,
  title,
  url: `https://example.com/${id}`,
  author: 'pg',
  points: 900,
  created_at: '2015-01-01T00:00:00Z', // old + popular => an "essay"
})

/**
 * Answers whichever of the three APIs is asked, so the pool is never empty.
 *
 * The HN adapter drops hits that have nothing to do with what it searched for, because
 * Algolia falls back to OR-matching on rare phrases and starts returning whatever is
 * popular. A stub that ignores the query would be filtered out by that guard, so this one
 * echoes the searched term into each hit's URL the way a real result usually carries it
 * in the slug. Which term gets searched rotates by day, so it is read off the request
 * rather than hardcoded.
 */
const stubNetwork = (hits: Array<{ objectID: string; title: string }>) =>
  vi.fn(async (url: string) => {
    const query = decodeURIComponent(/[?&]query=([^&]*)/.exec(url)?.[1] ?? '')
    const body = url.includes('hn.algolia')
      ? { hits: hits.map((h) => ({ ...h, url: `https://example.com/${h.objectID}/${query.replace(/\s+/g, '-')}` })) }
      : url.includes('openalex')
        ? { results: [] }
        : { message: { items: [] } }
    return { ok: true, json: async () => body } as unknown as Response
  })

beforeEach(async () => {
  await clearAll()
  await store.load()
})
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('the daily read', () => {
  it('says so plainly when every source is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<App />)

    await waitFor(() => expect(screen.getByText(/Nothing picked yet/)).toBeDefined())
    // an honest gap, not an error the user cannot act on
    expect(screen.queryByText(/error/i)).toBeNull()
    expect(screen.getByText('Try now')).toBeDefined()
  })

  it('picks something, and picks the same thing on a reload', async () => {
    vi.stubGlobal('fetch', stubNetwork([hnHit('1', 'The Age of the Essay')]))
    render(<App />)

    await waitFor(() => expect(screen.getByText('The Age of the Essay')).toBeDefined())
    const first = store.readFor(store.todayKey())!.sourceId

    // a second pass must not re-roll: the pick is decided once and stored
    await act(async () => { await store.fillReadBuffer() })
    expect(store.readFor(store.todayKey())!.sourceId).toBe(first)
  })

  it('fills three days ahead so being offline tomorrow still has something', async () => {
    vi.stubGlobal(
      'fetch',
      stubNetwork(Array.from({ length: 12 }, (_, i) => hnHit(`h${i}`, `A Considered Piece Number ${i}`))),
    )
    await act(async () => { await store.fillReadBuffer() })

    const reads = store.getSnapshot().dailyReads.filter((r) => !r.deletedAt)
    expect(reads).toHaveLength(3)
    // and they are three different pieces, not the same one three times
    expect(new Set(reads.map((r) => r.sourceId)).size).toBe(3)
  })

  it('draws a replacement when you skip, and never offers the skipped one again', async () => {
    vi.stubGlobal(
      'fetch',
      stubNetwork(Array.from({ length: 12 }, (_, i) => hnHit(`h${i}`, `A Considered Piece Number ${i}`))),
    )
    render(<App />)
    await waitFor(() => expect(screen.getByText('Skip')).toBeDefined())

    const before = store.readFor(store.todayKey())!.sourceId
    fireEvent.click(screen.getByText('Skip'))
    await act(async () => { await Promise.resolve() })

    await waitFor(() => {
      const after = store.readFor(store.todayKey())
      expect(after).not.toBeNull()
      expect(after!.sourceId).not.toBe(before)
    })
  })

  it('marks a piece read without touching any streak', async () => {
    vi.stubGlobal('fetch', stubNetwork([hnHit('1', 'Hackers and Painters')]))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Mark read')).toBeDefined())

    fireEvent.click(screen.getByText('Mark read'))
    await act(async () => { await Promise.resolve() })

    await waitFor(() => expect(screen.getByText('✓ Read')).toBeDefined())
    // it is a feed, not a habit: nothing was logged against a task
    expect(store.getSnapshot().entries).toHaveLength(0)
  })

  it('ignores Ask HN posts, which have no link to read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('hn.algolia')
            ? { hits: [{ objectID: '9', title: 'Ask HN: what are you working on?', url: null, points: 800 }] }
            : url.includes('openalex')
              ? { results: [] }
              : { message: { items: [] } },
      })) as unknown as typeof fetch,
    )
    await act(async () => { await store.fillReadBuffer() })
    expect(store.getSnapshot().dailyReads).toHaveLength(0)
  })
})
