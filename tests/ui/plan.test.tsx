// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { App } from '../../src/App'
import { store } from '../../src/db/store'
import { clearAll } from '../../src/db/idb'

/**
 * Overlapping blocks on the day-plan canvas.
 *
 * The grid used to key blocks into a `Map<number, Block>` by start slot and walk the day
 * in order, skipping ground it had already covered. Two blocks in one slot meant the
 * second replaced the first in the map; two that merely overlapped meant the cursor
 * jumped past the first and skipped the second as covered. Either way the block was gone
 * from the screen with nothing to say so, and the only way to find it again was to delete
 * the one hiding it.
 */

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

/** 9:00 AM on a day that starts at 04:00. */
const NINE_AM = 300

const seed = async (blocks: Array<{ title: string; start: number; minutes: number }>) => {
  const plan = await store.ensurePlan(store.todayKey())
  for (const b of blocks) {
    await store.addBlock(plan.id, {
      title: b.title,
      plannedStartMinute: b.start,
      plannedMinutes: b.minutes,
      sortOrder: b.start,
    })
  }
}

const openPlan = async (): Promise<void> => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /Schedule/ }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Schedule' })).toBeDefined())
}

beforeEach(async () => {
  await clearAll()
  await store.load()
})

afterEach(() => {
  cleanup()
})

describe('the day plan canvas', () => {
  it('draws two blocks that start in the same slot', async () => {
    await seed([
      { title: 'Reading', start: NINE_AM, minutes: 60 },
      { title: 'Standup', start: NINE_AM, minutes: 60 },
    ])
    await openPlan()

    expect(screen.getByText('Reading')).toBeDefined()
    expect(screen.getByText('Standup')).toBeDefined()
  })

  it('draws a block that overlaps another without swallowing either', async () => {
    await seed([
      { title: 'Reading', start: NINE_AM, minutes: 60 },
      { title: 'Standup', start: NINE_AM + 30, minutes: 60 },
    ])
    await openPlan()

    expect(screen.getByText('Reading')).toBeDefined()
    expect(screen.getByText('Standup')).toBeDefined()
  })

  it('opens each of two blocks sharing a slot, not whichever is on top', async () => {
    await seed([
      { title: 'Reading', start: NINE_AM, minutes: 60 },
      { title: 'Standup', start: NINE_AM, minutes: 60 },
    ])
    await openPlan()

    for (const title of ['Reading', 'Standup']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }))
      const dialog = await screen.findByRole('dialog')
      expect((within(dialog).getByLabelText('What is it?') as HTMLInputElement).value).toBe(title)
      fireEvent.click(within(dialog).getByText('Delete'))
      await flush()
    }
  })

  it('still frees the slots a cluster does not reach', async () => {
    await seed([
      { title: 'Reading', start: NINE_AM, minutes: 60 },
      { title: 'Standup', start: NINE_AM + 30, minutes: 60 },
    ])
    await openPlan()

    // the pair covers 9:00 through 10:30; the slot after it stays tappable
    expect(screen.queryByLabelText('Schedule 9:30 AM')).toBeNull()
    expect(screen.queryByLabelText('Schedule 10:15 AM')).toBeNull()
    expect(screen.getByLabelText('Schedule 10:30 AM')).toBeDefined()
  })

  it('leaves a lone block reading exactly as it did before', async () => {
    await seed([{ title: 'Deep work', start: NINE_AM, minutes: 60 }])
    await openPlan()

    expect(screen.getByText('Deep work')).toBeDefined()
    // a block with the row to itself still shows its duration
    expect(screen.getAllByText('1h').length).toBeGreaterThan(0)
  })
})

describe('a block flush against the end of the day', () => {
  /**
   * What the tail of a split session looks like: a session running through 04:00 leaves
   * a block on the earlier day that ends exactly at minute 1440. The grid walks
   * `m < MINUTES_PER_DAY`, so a block finishing precisely on that bound is the one most
   * likely to fall off it.
   */
  it('renders, and takes the last slots of the day with it', async () => {
    await seed([{ title: 'Reading', start: 1410, minutes: 30 }]) // 03:30 to 04:00
    await openPlan()

    expect(screen.getByText('Reading')).toBeDefined()
    expect(screen.queryByLabelText('Schedule 3:30 AM')).toBeNull()
    expect(screen.queryByLabelText('Schedule 3:45 AM')).toBeNull() // the day's last slot
    expect(screen.getByLabelText('Schedule 3:15 AM')).toBeDefined()
  })

  it('leaves the rest of the day plannable', async () => {
    await seed([{ title: 'Reading', start: 1410, minutes: 30 }])
    await openPlan()
    // 96 slots in a day, two of them now covered
    expect(document.querySelectorAll('.slot')).toHaveLength(94)
  })
})
