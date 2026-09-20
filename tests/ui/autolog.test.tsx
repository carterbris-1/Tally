// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/App'
import { store } from '../../src/db/store'
import { clearAll } from '../../src/db/idb'

/** The whole point, seen the way a user sees it: time it, stop it, find it on the schedule. */

beforeEach(async () => {
  await clearAll()
  await store.load()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('a timed session on a flagged task', () => {
  it('shows up on the schedule, ticked, once the timer stops', async () => {
    const task = await store.createTask({ title: 'Read', kind: 'timer', logToPlan: true })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-20T18:05:00.000Z')) // 14:05 Eastern
    const entry = await store.startTimer('task', task.id)
    vi.setSystemTime(new Date('2026-09-20T18:50:00.000Z')) // 45 minutes later
    await act(async () => { await store.stopTimer(entry.id) })
    vi.useRealTimers()

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Schedule/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Schedule' })).toBeDefined())

    // the tick is rendered inside the title span, so the cell reads "✓ Read"
    const cell = screen.getByRole('button', { name: /Read/ })
    expect(cell.textContent).toContain('✓')
    expect(cell.textContent).toContain('Read')
    // 14:05 snaps to the 14:00 row; the slot it occupies is no longer plannable
    expect(screen.queryByLabelText('Schedule 2:00 PM')).toBeNull()
    expect(screen.getByLabelText('Schedule 3:00 PM')).toBeDefined()
  })
})

describe('the Schedule toggle in the task editor', () => {
  const openNewTask = async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('New task')).toBeDefined())
    fireEvent.click(screen.getByLabelText('New task'))
    return screen.findByRole('dialog')
  }

  it('turns on, saves, and is still on when the task is reopened', async () => {
    let dialog = await openNewTask()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Read' } })
    fireEvent.click(within(dialog).getByText('Just track')) // no target to fill in
    fireEvent.click(within(dialog).getByText('Add to schedule'))
    fireEvent.click(within(dialog).getByText('Create'))
    await act(async () => { await Promise.resolve() })

    await waitFor(() => expect(store.getSnapshot().tasks).toHaveLength(1))
    expect(store.getSnapshot().tasks[0]!.logToPlan).toBe(true)

    // reopen it the way a user would — tap the task, then Edit — and the toggle must
    // still be on rather than quietly reset
    fireEvent.click(screen.getByText('Read'))
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined())
    fireEvent.click(screen.getByText('Edit'))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('✓ Added when you stop')).toBeDefined()
  })

  it('is off unless you ask for it', async () => {
    const dialog = await openNewTask()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Read' } })
    fireEvent.click(within(dialog).getByText('Just track'))
    fireEvent.click(within(dialog).getByText('Create'))
    await act(async () => { await Promise.resolve() })

    await waitFor(() => expect(store.getSnapshot().tasks).toHaveLength(1))
    expect(store.getSnapshot().tasks[0]!.logToPlan).toBe(false)
  })

  it('is not offered for kinds that have no session to place', async () => {
    const dialog = await openNewTask()
    expect(within(dialog).getByText('Add to schedule')).toBeDefined()
    fireEvent.click(within(dialog).getByText('Checkbox'))
    expect(within(dialog).queryByText('Add to schedule')).toBeNull()
  })

  it('clears the flag if the task stops being a timer', async () => {
    const dialog = await openNewTask()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Read' } })
    fireEvent.click(within(dialog).getByText('Add to schedule'))
    fireEvent.click(within(dialog).getByText('Checkbox')) // no sessions now
    fireEvent.click(within(dialog).getByText('Create'))
    await act(async () => { await Promise.resolve() })

    await waitFor(() => expect(store.getSnapshot().tasks).toHaveLength(1))
    expect(store.getSnapshot().tasks[0]!.logToPlan).toBe(false)
  })
})
