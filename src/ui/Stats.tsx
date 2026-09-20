import { useMemo, useState } from 'react'
import {
  earliestDay,
  rangeFor,
  statsForTask,
  timeOfDayBuckets,
  type StatsWindow,
} from '../core/stats'
import { liveTasks, taskEntries } from '../db/selectors'
import { formatAmount, formatDuration } from './format'
import { useNow, useSnapshot, useStore } from './hooks'

const WINDOWS: Array<[StatsWindow, string]> = [
  ['week', 'This week'],
  ['month', 'This month'],
  ['all', 'All time'],
]

export function Stats() {
  const s = useSnapshot()
  const store = useStore()
  const now = useNow()
  const cfg = store.dayConfig
  const [window, setWindow] = useState<StatsWindow>('month')
  const dayKey = store.todayKey(now)

  /**
   * Memoised on the day, not the second.
   *
   * A one-second ticker runs whenever a timer is going, and these functions walk a day
   * range per task. Keying on `now` would defeat the cache entirely; keying on nothing
   * would serve stale numbers after an edit. The day is the honest middle: a running
   * timer moves today's total, and nothing here reports today to the second.
   */
  const rows = useMemo(() => {
    const tasks = liveTasks(s)
    return tasks.map((task) => {
      const entries = taskEntries(s, task.id)
      const range = rangeFor(window, dayKey, store.weekStartDay, earliestDay(entries, dayKey))
      return {
        task,
        range,
        stats: statsForTask(task, entries, cfg, store.weekStartDay, range, now),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.entries, s.tasks, dayKey, window, store.weekStartDay])

  const buckets = useMemo(() => {
    const timers = liveTasks(s).filter((t) => t.kind === 'timer')
    const allEntries = timers.flatMap((t) => taskEntries(s, t.id))
    const range = rangeFor(window, dayKey, store.weekStartDay, earliestDay(allEntries, dayKey))
    return timeOfDayBuckets(allEntries, cfg, range, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.entries, s.tasks, dayKey, window, store.weekStartDay])

  const peak = Math.max(...buckets, 1)
  const trackedSeconds = buckets.reduce((a, b) => a + b, 0)

  return (
    <div className="wrap">
      <header className="screen-head">
        <h1>Stats</h1>
        <span className="sub">{WINDOWS.find(([w]) => w === window)?.[1]}</span>
      </header>

      <div className="seg" style={{ marginBottom: 18 }}>
        {WINDOWS.map(([value, label]) => (
          <button
            key={value}
            className={`pill${window === value ? ' active' : ''}`}
            onClick={() => setWindow(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <strong>Nothing to count yet</strong>
          Stats appear once you have tasks with some history behind them.
        </div>
      ) : null}

      {rows.map(({ task, stats }) => (
        <div className="row" key={task.id} style={{ display: 'block' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span className="title">{task.title}</span>
            <span className="num muted">{formatAmount(task, stats.total)}</span>
          </div>
          <div className="meta">
            {stats.completePeriods} of {stats.scheduledPeriods} {stats.periodLabel}
            {stats.scheduledPeriods > 0 ? ` · ${Math.round(stats.rate * 100)}%` : ''}
            {stats.activeDays !== stats.completePeriods && stats.periodLabel === 'days'
              ? ` · touched on ${stats.activeDays}`
              : ''}
          </div>
          <div className="progress">
            <i style={{ width: `${stats.rate * 100}%`, background: task.colorHex }} />
          </div>
        </div>
      ))}

      {trackedSeconds > 0 ? (
        <>
          <div className="section-label">When you actually start</div>
          <div className="card" style={{ padding: '14px 13px 10px' }}>
            <div className="hours">
              {buckets.map((seconds, hour) => (
                <div
                  key={hour}
                  className="hour"
                  title={`${String(hour).padStart(2, '0')}:00 · ${formatDuration(seconds)}`}
                >
                  <i style={{ height: `${Math.max(2, (seconds / peak) * 100)}%` }} />
                  {hour % 6 === 0 ? <span>{hour}</span> : null}
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Each session counts once, in the hour it began — this is when you sit down,
              not when you were busy.
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
