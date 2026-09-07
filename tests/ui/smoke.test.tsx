// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../../src/App'
import { store } from '../../src/db/store'
import { clearAll } from '../../src/db/idb'

/**
 * Does the app actually run?
 *
 * A green typecheck and a successful build both pass on a page that throws on mount
 * and renders nothing. These are the paths a person takes in the first minute.
 */

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(async () => {
  // each test starts from an empty database, so titles stay unambiguous
  await clearAll()
  await store.load()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the app', () => {
  it('renders the Today screen with an empty state', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Today' })).toBeDefined())
    expect(screen.getByText('No tasks yet')).toBeDefined()
  })

  it('shows a created task and starts and stops its timer', async () => {
    await act(async () => {
      await store.createTask({ title: 'Read', kind: 'timer', goalDirection: 'atLeast', goalValue: 1800 })
    })
    render(<App />)

    await waitFor(() => expect(screen.getByText('Read')).toBeDefined())
    expect(screen.getByText(/30m goal/)).toBeDefined()

    fireEvent.click(screen.getByLabelText('Start Read'))
    await flush()
    await waitFor(() => expect(screen.getByText('Stop')).toBeDefined())
    expect(store.runningEntries()).toHaveLength(1)

    fireEvent.click(screen.getByText('Stop'))
    await flush()
    await waitFor(() => expect(store.runningEntries()).toHaveLength(0))
  })

  it('checks off a checkbox task', async () => {
    await act(async () => {
      await store.createTask({ title: 'Vitamins', kind: 'checkbox' })
    })
    render(<App />)

    await waitFor(() => expect(screen.getByLabelText('Check Vitamins')).toBeDefined())
    fireEvent.click(screen.getByLabelText('Check Vitamins'))
    await flush()
    await waitFor(() => expect(screen.getByLabelText('Uncheck Vitamins')).toBeDefined())
  })

  it('quick-adds a quantity and accumulates the daily total', async () => {
    await act(async () => {
      await store.createTask({
        title: 'Water',
        kind: 'quantity',
        goalDirection: 'atLeast',
        goalValue: 2000,
        unitLabel: 'ml',
        quickAdds: [250, 500],
      })
    })
    render(<App />)

    await waitFor(() => expect(screen.getByText('+250')).toBeDefined())
    fireEvent.click(screen.getByText('+250'))
    await flush()
    fireEvent.click(screen.getByText('+500'))
    await flush()
    await waitFor(() => expect(screen.getByText('750 ml')).toBeDefined())
  })

  it('never says a limit task is complete, only on track or exceeded', async () => {
    await act(async () => {
      const task = await store.createTask({
        title: 'TV',
        kind: 'timer',
        goalDirection: 'atMost',
        goalValue: 7200, // 2h
      })
      await store.addManualSeconds('task', task.id, 3600)
    })
    render(<App />)

    await waitFor(() => expect(screen.getByText('on track')).toBeDefined())
    expect(screen.queryByText('complete')).toBeNull()

    const tv = store.getSnapshot().tasks.find((t) => t.title === 'TV')!
    await act(async () => {
      await store.addManualSeconds('task', tv.id, 7200) // now 3h against a 2h limit
    })
    await waitFor(() => expect(screen.getByText('exceeded')).toBeDefined())
  })

  it('moves between tabs and creates a to-do', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Today' })).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /To-dos/ }))
    await waitFor(() => expect(screen.getByText('Nothing to do')).toBeDefined())

    fireEvent.click(screen.getByLabelText('New to-do'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Call the bank' } })
    fireEvent.click(within(dialog).getByText('Save'))
    await flush()

    await waitFor(() => expect(screen.getByText('Call the bank')).toBeDefined())
  })

  it('lays the whole day out in 15-minute slots', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }))

    // the day starts at 04:00 and runs a full 24 hours, a slot at a time
    await waitFor(() => expect(screen.getByLabelText('Plan 4:00 AM')).toBeDefined())
    expect(screen.getByLabelText('Plan 4:15 AM')).toBeDefined()
    expect(screen.getByLabelText('Plan 3:45 AM')).toBeDefined() // the last slot, next morning
  })

  it('stretches a block across a tapped range and merges the slots', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }))
    await waitFor(() => expect(screen.getByLabelText('Plan 9:00 AM')).toBeDefined())

    // tap the start, then tap the last slot it should cover
    fireEvent.click(screen.getByLabelText('Plan 9:00 AM'))
    fireEvent.click(screen.getByLabelText('Plan 9:45 AM'))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('What is it?'), { target: { value: 'Study' } })
    fireEvent.click(within(dialog).getByText('Save'))
    await flush()

    await waitFor(() => expect(screen.getByText('Study')).toBeDefined())
    // four slots became one hour-long cell, and those slots are no longer tappable
    expect(screen.getAllByText('1h').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Plan 9:15 AM')).toBeNull()
    expect(screen.queryByLabelText('Plan 9:45 AM')).toBeNull()
    expect(screen.getByLabelText('Plan 10:00 AM')).toBeDefined()
  })

  it('has no timer anywhere in the plan — it is intention, not measurement', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }))
    await waitFor(() => expect(screen.getByLabelText('Plan 4:00 AM')).toBeDefined())
    expect(screen.queryByLabelText(/^Start /)).toBeNull()
    expect(screen.queryByLabelText(/^Stop /)).toBeNull()
  })

  it('creates a project and weights its progress by estimate', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    await waitFor(() => expect(screen.getByText('No projects')).toBeDefined())

    fireEvent.click(screen.getByLabelText('New project'))
    let dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Rewrite' } })
    fireEvent.click(within(dialog).getByText('Save'))
    await flush()

    await waitFor(() => expect(screen.getByText('Rewrite')).toBeDefined())
    fireEvent.click(screen.getByText('Rewrite'))

    for (const [title, hours] of [
      ['Draft', '20'],
      ['Polish', '2'],
    ] as const) {
      fireEvent.click(await screen.findByText('+ Add phase'))
      dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: title } })
      fireEvent.change(within(dialog).getByLabelText('Estimated hours'), { target: { value: hours } })
      fireEvent.click(within(dialog).getByText('Save'))
      await flush()
    }

    await waitFor(() => expect(screen.getByText('Draft')).toBeDefined())
    fireEvent.click(screen.getByLabelText('Mark Draft done'))
    await flush()

    // 20h of 22h done — a count-weighted bar would have said 50%
    await waitFor(() => expect(screen.getByText('91%')).toBeDefined())
  })

  it('refuses to save a target-shaped task with no target', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('New task')).toBeDefined())
    fireEvent.click(screen.getByLabelText('New task'))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Read' } })
    fireEvent.click(within(dialog).getByText('At least'))

    // a direction with no number used to save happily and then complete on any activity
    expect(within(dialog).getByText(/Set the target/)).toBeDefined()
    fireEvent.click(within(dialog).getByText('Create'))
    await flush()
    expect(store.getSnapshot().tasks).toHaveLength(0)

    fireEvent.change(within(dialog).getByLabelText(/Target/), { target: { value: '30m' } })
    await waitFor(() => expect(within(dialog).getByText('30m')).toBeDefined())
    fireEvent.click(within(dialog).getByText('Create'))
    await flush()

    await waitFor(() => expect(store.getSnapshot().tasks).toHaveLength(1))
    expect(store.getSnapshot().tasks[0]?.goalValue).toBe(1800)
  })

  it('is not a success until the whole allocated time is done', async () => {
    await act(async () => {
      const task = await store.createTask({
        title: 'Read',
        kind: 'timer',
        goalDirection: 'atLeast',
        goalValue: 30 * 60,
      })
      await store.addManualSeconds('task', task.id, 5 * 60) // 5 of 30 minutes
    })
    render(<App />)

    await waitFor(() => expect(screen.getByText('Read')).toBeDefined())
    expect(screen.getByText(/30m goal/)).toBeDefined()
    expect(screen.queryByText('1')).toBeNull() // no tick, no streak, not yet

    const read = store.getSnapshot().tasks.find((t) => t.title === 'Read')!
    await act(async () => {
      await store.addManualSeconds('task', read.id, 25 * 60) // now exactly 30
    })
    await waitFor(() => expect(screen.getByText('1')).toBeDefined())
  })

  it('counts up inside the ring as the streak grows', async () => {
    await act(async () => {
      await store.createTask({ title: 'Vitamins', kind: 'checkbox' })
    })
    render(<App />)

    // nothing in the ring until the day is actually done
    await waitFor(() => expect(screen.getByLabelText('Check Vitamins')).toBeDefined())
    expect(screen.queryByText('1')).toBeNull()

    fireEvent.click(screen.getByLabelText('Check Vitamins'))
    await flush()
    await waitFor(() => expect(screen.getByText('1')).toBeDefined())

    // unchecking takes the number away again
    fireEvent.click(screen.getByLabelText('Uncheck Vitamins'))
    await flush()
    await waitFor(() => expect(screen.queryByText('1')).toBeNull())
  })

  it('groups projects under headings and folds casing together', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    await waitFor(() => expect(screen.getByText('No projects')).toBeDefined())

    const addProject = async (title: string, group: string): Promise<void> => {
      fireEvent.click(screen.getByLabelText('New project'))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: title } })
      fireEvent.change(within(dialog).getByLabelText('Group'), { target: { value: group } })
      fireEvent.click(within(dialog).getByText('Save'))
      await flush()
    }

    await addProject('Deck', 'house')
    await addProject('Tally', 'Dev')
    await addProject('Gutters', '  HOUSE  ')
    await addProject('Loose end', '')

    await waitFor(() => expect(screen.getByText('Loose end')).toBeDefined())

    // Dev sorts first, HOUSE joined house rather than starting a rival group,
    // and the ungrouped pile sits at the bottom
    const headings = [...container.querySelectorAll('.section-label')].map((h) => h.textContent)
    expect(headings).toEqual(['Dev · 1', 'house · 2', 'Ungrouped · 1'])
  })

  it('offers existing groups as pills so a typo cannot fork one', async () => {
    await act(async () => {
      await store.createProject({ title: 'Deck', group: 'house' })
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    await waitFor(() => expect(screen.getByText('Deck')).toBeDefined())

    fireEvent.click(screen.getByLabelText('New project'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Gutters' } })
    fireEvent.click(within(dialog).getByText('house')) // the suggestion pill
    fireEvent.click(within(dialog).getByText('Save'))
    await flush()

    await waitFor(() => expect(screen.getByText('Gutters')).toBeDefined())
    expect(store.getSnapshot().projects.every((p) => p.group === 'house')).toBe(true)
  })

  it('opens task detail and shows a streak', async () => {
    await act(async () => {
      const task = await store.createTask({ title: 'Read', kind: 'timer', goalDirection: 'atLeast', goalValue: 60 })
      await store.addManualSeconds('task', task.id, 600)
    })
    render(<App />)

    fireEvent.click(await screen.findByText('Read'))
    await waitFor(() => expect(screen.getByText('Current streak')).toBeDefined())
    expect(screen.getByText('Longest')).toBeDefined()
  })
})
