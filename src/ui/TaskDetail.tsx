import { useState } from 'react'
import { addDayKey } from '../core/dayKey'
import { sessionSeconds } from '../core/sessionSplit'
import { describeSchedule } from '../core/schedule'
import { skipsUsedInMonth } from '../core/streak'
import type { Entry, Task } from '../core/types'
import { dayTotalsFor, heatmap, streaksFor, taskEntries, taskToday } from '../db/selectors'
import { formatAmount, formatDayKeyShort, formatDuration, parseDurationToSeconds } from './format'
import { useNow, useSnapshot, useStore } from './hooks'
import { Ring } from './shared/Ring'
import { Sheet } from './shared/Sheet'

interface Props {
  taskId: string
  onBack: () => void
  onEdit: (task: Task) => void
}

const HEATMAP_DAYS = 133 // 19 weeks, a tidy grid

export function TaskDetail({ taskId, onBack, onEdit }: Props) {
  const s = useSnapshot()
  const store = useStore()
  const now = useNow()
  const cfg = store.dayConfig
  const dayKey = store.todayKey(now)
  const [adding, setAdding] = useState(false)

  const task = s.tasks.find((t) => t.id === taskId && !t.deletedAt)
  if (!task) {
    return (
      <div className="wrap">
        <button className="pill ghost" onClick={onBack}>
          ← Back
        </button>
        <div className="empty">This task no longer exists.</div>
      </div>
    )
  }

  const view = taskToday(s, task, dayKey, cfg, now)
  const streaks = streaksFor(s, task, cfg, now)
  const cells = heatmap(s, task, cfg, now, HEATMAP_DAYS, dayKey)
  const totals = dayTotalsFor(s, task, cfg, now)
  const entries = taskEntries(s, task.id)
    .filter((e) => !e.isSkip)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40)
  const skipsUsed = skipsUsedInMonth(taskEntries(s, task.id), dayKey)
  const allowance = s.settings.skipDaysPerMonth
  const exceeded = task.goalDirection === 'atMost' && task.goalValue !== null && view.total > task.goalValue

  return (
    <div className="wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <button className="pill ghost" onClick={onBack}>
          ← Back
        </button>
        <button className="pill ghost" onClick={() => onEdit(task)}>
          Edit
        </button>
      </div>

      <header className="screen-head" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Ring fraction={view.fraction} color={task.colorHex} exceeded={exceeded} size={62}>
            {task.kind === 'checkbox' ? (view.status === 'complete' ? '✓' : '') : `${Math.round(view.fraction * 100)}%`}
          </Ring>
          <div>
            <h1 style={{ fontSize: 22 }}>{task.title}</h1>
            <div className="sub">
              {describeSchedule(task.schedule)} · {formatAmount(task, view.total)} today
            </div>
          </div>
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <div className="v num">{streaks.current}</div>
          <div className="k">Current streak</div>
        </div>
        <div className="stat">
          <div className="v num">{streaks.longest}</div>
          <div className="k">Longest</div>
        </div>
        <div className="stat">
          <div className="v num">{streaks.totalCompletions}</div>
          <div className="k">Completions</div>
        </div>
      </div>

      <div className="section-label">Last {Math.round(HEATMAP_DAYS / 7)} weeks</div>
      <div className="card" style={{ padding: 13 }}>
        <div className="heat">
          {cells.map((c) => (
            <i
              key={c.dayKey}
              className={c.status}
              title={`${c.dayKey} · ${c.status}${totals.get(c.dayKey) ? ` · ${formatAmount(task, totals.get(c.dayKey)!)}` : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="section-label">Today</div>
      <div className="seg">
        {task.kind === 'timer' ? (
          <>
            <button className="pill" onClick={() => void store.toggleTimer('task', task.id)}>
              {view.running ? 'Stop timer' : 'Start timer'}
            </button>
            <button className="pill" onClick={() => setAdding(true)}>
              Add time
            </button>
          </>
        ) : null}
        <button
          className={`pill${view.skipped ? ' active' : ''}`}
          onClick={() => void store.setSkip(task.id, dayKey, !view.skipped)}
        >
          {view.skipped ? 'Un-skip today' : 'Skip today'}
        </button>
      </div>
      {allowance !== null ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {skipsUsed} of {allowance} skip days used this month.
          {skipsUsed > allowance ? ' Over the allowance — skips still count as neutral.' : ''}
        </div>
      ) : null}

      <div className="section-label">History</div>
      {entries.length === 0 ? (
        <div className="empty">Nothing logged yet.</div>
      ) : (
        <ul className="list-reset">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} task={task} now={now} />
          ))}
        </ul>
      )}

      <div className="section-label">Danger zone</div>
      <div className="seg">
        <button className="pill" onClick={() => void store.updateTask(task.id, { isArchived: !task.isArchived })}>
          {task.isArchived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          className="pill"
          style={{ color: 'var(--bad)' }}
          onClick={() => {
            if (confirm(`Delete "${task.title}" and everything logged against it?`)) {
              void store.deleteTask(task.id)
              onBack()
            }
          }}
        >
          Delete task
        </button>
      </div>

      {adding ? <AddTimeSheet taskId={task.id} dayKey={dayKey} onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

function EntryRow({ entry, task, now }: { entry: Entry; task: Task; now: number }) {
  const store = useStore()
  const value = entry.startedAt
    ? sessionSeconds(entry.startedAt, entry.endedAt, now)
    : entry.amount
  const when = entry.startedAt
    ? new Date(entry.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : new Date(entry.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <li className="row" style={{ minHeight: 52 }}>
      <div className="body">
        <div className="title num" style={{ fontSize: 14 }}>
          {formatAmount(task, value)}
          {entry.startedAt && !entry.endedAt ? <span className="danger-text"> · running</span> : null}
        </div>
        <div className="meta">
          {formatDayKeyShort(entry.dayKey)} · {when}
        </div>
      </div>
      <button className="pill ghost" onClick={() => void store.deleteEntry(entry.id)} aria-label="Delete entry">
        ✕
      </button>
    </li>
  )
}

function AddTimeSheet({ taskId, dayKey, onClose }: { taskId: string; dayKey: string; onClose: () => void }) {
  const store = useStore()
  const [text, setText] = useState('')
  const [day, setDay] = useState(dayKey)
  const seconds = parseDurationToSeconds(text)

  return (
    <Sheet title="Add time" onClose={onClose}>
      <div className="field">
        <label htmlFor="dur">Duration</label>
        <input id="dur" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="45m" />
        {seconds ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{formatDuration(seconds)}</div> : null}
      </div>
      <div className="field">
        <label htmlFor="day">Day</label>
        <div className="seg">
          <button className={`pill${day === dayKey ? ' active' : ''}`} onClick={() => setDay(dayKey)}>
            Today
          </button>
          <button
            className={`pill${day === addDayKey(dayKey, -1) ? ' active' : ''}`}
            onClick={() => setDay(addDayKey(dayKey, -1))}
          >
            Yesterday
          </button>
        </div>
      </div>
      <div className="sheet-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          onClick={() => {
            if (seconds) void store.addManualSeconds('task', taskId, seconds, day)
            onClose()
          }}
        >
          Add
        </button>
      </div>
    </Sheet>
  )
}
