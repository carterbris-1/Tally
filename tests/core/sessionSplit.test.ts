import { describe, expect, it } from 'vitest'
import { isRunning, sessionSeconds, splitSession } from '../../src/core/sessionSplit'
import { dailyTotals } from '../../src/core/aggregate'
import type { Entry } from '../../src/core/types'
import { HOUR, NY, wallClock as ny } from '../helpers'

const entry = (over: Partial<Entry>): Entry => ({
  id: crypto.randomUUID(),
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
  ownerType: 'task',
  ownerId: 'task-1',
  dayKey: '2026-09-01',
  startedAt: null,
  endedAt: null,
  amount: 0,
  note: '',
  isSkip: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

describe('splitSession — the test the spec asked for', () => {
  it('splits 03:45 to 05:15 into 15 minutes yesterday and 75 today', () => {
    const slices = splitSession(ny('2026-09-01T03:45'), ny('2026-09-01T05:15'), NY)
    expect(slices).toEqual([
      { dayKey: '2026-08-31', seconds: 15 * 60 },
      { dayKey: '2026-09-01', seconds: 75 * 60 },
    ])
  })

  it('does the same across the spring-forward boundary', () => {
    // 03:45 EDT exists on 2026-03-08; the clock skipped 02:00-03:00, not 03:45
    const slices = splitSession(ny('2026-03-08T03:45'), ny('2026-03-08T05:15'), NY)
    expect(slices).toEqual([
      { dayKey: '2026-03-07', seconds: 15 * 60 },
      { dayKey: '2026-03-08', seconds: 75 * 60 },
    ])
  })

  it('does the same across the fall-back boundary', () => {
    const slices = splitSession(ny('2026-11-01T03:45'), ny('2026-11-01T05:15'), NY)
    const total = slices.reduce((s, x) => s + x.seconds, 0)
    expect(slices.map((s) => s.dayKey)).toEqual(['2026-10-31', '2026-11-01'])
    expect(slices[1]?.seconds).toBe(75 * 60)
    // the repeated 01:00 hour lands before this session, so it is still 90 minutes
    expect(total).toBe(90 * 60)
  })

  it('leaves a session inside one day alone', () => {
    const slices = splitSession(ny('2026-09-01T10:00'), ny('2026-09-01T11:30'), NY)
    expect(slices).toEqual([{ dayKey: '2026-09-01', seconds: 90 * 60 }])
  })

  it('spans multiple days for a session left running for three days', () => {
    const slices = splitSession(ny('2026-09-01T10:00'), ny('2026-09-04T10:00'), NY)
    expect(slices.map((s) => s.dayKey)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'])
    expect(slices.reduce((s, x) => s + x.seconds, 0)).toBe(72 * HOUR / 1000)
  })

  it('returns nothing for a zero-length or inverted session', () => {
    expect(splitSession(ny('2026-09-01T10:00'), ny('2026-09-01T10:00'), NY)).toEqual([])
    expect(splitSession(ny('2026-09-01T11:00'), ny('2026-09-01T10:00'), NY)).toEqual([])
  })
})

describe('sessionSeconds', () => {
  it('derives elapsed time for a running session rather than accumulating it', () => {
    const started = ny('2026-09-01T10:00').toISOString()
    expect(sessionSeconds(started, null, ny('2026-09-01T10:30'))).toBe(1800)
    expect(sessionSeconds(started, null, ny('2026-09-01T11:00'))).toBe(3600)
    expect(isRunning(started, null)).toBe(true)
  })

  it('survives a gap with no app running — elapsed is a subtraction, not a tick count', () => {
    const started = ny('2026-09-01T10:00').toISOString()
    expect(sessionSeconds(started, null, ny('2026-09-03T10:00'))).toBe(48 * 3600)
  })
})

describe('dailyTotals', () => {
  it('splits a block session the same way it splits a task timer', () => {
    // planning spec task 13: 03:30-05:00 is 90 min on the block, 30/60 across days
    const e = entry({
      ownerType: 'block',
      ownerId: 'block-1',
      dayKey: '2026-08-31',
      startedAt: ny('2026-09-01T03:30').toISOString(),
      endedAt: ny('2026-09-01T05:00').toISOString(),
    })
    const totals = dailyTotals([e], 'timer', NY)
    expect(totals.get('2026-08-31')).toBe(30 * 60)
    expect(totals.get('2026-09-01')).toBe(60 * 60)
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(90 * 60)
  })

  it('counts manual timer entries with no session against their stamped day', () => {
    const e = entry({ dayKey: '2026-09-01', amount: 45 * 60 })
    expect(dailyTotals([e], 'timer', NY).get('2026-09-01')).toBe(45 * 60)
  })

  it('sums quantity entries by stamped day and ignores skips and tombstones', () => {
    const entries = [
      entry({ dayKey: '2026-09-01', amount: 250 }),
      entry({ dayKey: '2026-09-01', amount: 500 }),
      entry({ dayKey: '2026-09-01', amount: 999, deletedAt: '2026-09-01T12:00:00.000Z' }),
      entry({ dayKey: '2026-09-02', amount: 100, isSkip: true }),
    ]
    const totals = dailyTotals(entries, 'quantity', NY)
    expect(totals.get('2026-09-01')).toBe(750)
    expect(totals.get('2026-09-02')).toBeUndefined()
  })
})
