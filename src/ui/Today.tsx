import { useState } from 'react'
import { sessionSeconds } from '../core/sessionSplit'
import { describeSchedule } from '../core/schedule'
import type { Task } from '../core/types'
import { liveTasks, streaksFor, taskToday, type TaskToday } from '../db/selectors'
import { formatAmount, formatClock, formatDayKeyLong, formatGoal } from './format'
import { useNow, useSnapshot, useStore } from './hooks'
import { RunningBar } from './RunningBar'
import { Ring } from './shared/Ring'
import { Sheet } from './shared/Sheet'

interface Props {
  onOpenTask: (id: string) => void
  onNewTask: () => void
}

export function Today({ onOpenTask, onNewTask }: Props) {
  const s = useSnapshot()
  const store = useStore()
  const now = useNow()
  const cfg = store.dayConfig
  const dayKey = store.todayKey(now)
  const [logging, setLogging] = useState<Task | null>(null)

  const views = liveTasks(s).map((task) => ({
    ...taskToday(s, task, dayKey, cfg, now),
    streak: streaksFor(s, task, cfg, now).current,
  }))
  const scheduled = views.filter((v) => v.scheduled && !v.skipped)
  const resting = views.filter((v) => !v.scheduled || v.skipped)

  return (
    <div className="wrap">
      <header className="screen-head">
        <h1>Today</h1>
        <span className="sub">{formatDayKeyLong(dayKey)}</span>
      </header>

      <RunningBar />

      {views.length === 0 ? (
        <div className="empty">
          <strong>No tasks yet</strong>
          A task can be a timer, a number you count toward, or a plain checkbox.
        </div>
      ) : null}

      {scheduled.map((v) => (
        <TaskRow key={v.task.id} view={v} dayKey={dayKey} now={now} onOpen={onOpenTask} onLog={setLogging} />
      ))}

      {resting.length > 0 ? (
        <>
          <div className="section-label">Not scheduled today</div>
          {resting.map((v) => (
            <TaskRow key={v.task.id} view={v} dayKey={dayKey} now={now} onOpen={onOpenTask} onLog={setLogging} />
          ))}
        </>
      ) : null}

      <button className="fab" onClick={onNewTask} aria-label="New task">
        +
      </button>

      {logging ? <LogSheet task={logging} dayKey={dayKey} onClose={() => setLogging(null)} /> : null}
    </div>
  )
}

interface RowProps {
  view: TaskToday & { streak: number }
  dayKey: string
  now: number
  onOpen: (id: string) => void
  onLog: (task: Task) => void
}

function TaskRow({ view, dayKey, now, onOpen, onLog }: RowProps) {
  const store = useStore()
  const { task, total, running, fraction, status, streak } = view
  const isLimit = task.goalDirection === 'atMost' && task.goalValue !== null
  const exceeded = isLimit && total > (task.goalValue ?? 0)
  const goal = formatGoal(task)

  const meta = (): React.ReactNode => {
    if (view.skipped) return 'Skipped'
    if (task.kind === 'checkbox') return describeSchedule(task.schedule)
    const value = running ? formatClock(sessionSeconds(running.startedAt, running.endedAt, now)) : formatAmount(task, total)
    if (!goal) return <span className="num">{value}</span>
    return (
      <>
        <span className="num">{value}</span> · {goal}
        {isLimit ? <> · <span className={exceeded ? 'over' : 'on'}>{exceeded ? 'exceeded' : 'on track'}</span></> : null}
      </>
    )
  }

  const action = (): React.ReactNode => {
    if (task.kind === 'timer') {
      return (
        <button
          className={`icon-btn${running ? ' running' : ''}`}
          onClick={() => void store.toggleTimer('task', task.id)}
          aria-label={running ? `Stop ${task.title}` : `Start ${task.title}`}
        >
          {running ? '■' : '▶'}
        </button>
      )
    }
    if (task.kind === 'checkbox') {
      const done = status === 'complete'
      return (
        <button
          className={`icon-btn${done ? ' done' : ''}`}
          onClick={() => void store.setCheckbox(task.id, dayKey, !done)}
          aria-label={`${done ? 'Uncheck' : 'Check'} ${task.title}`}
        >
          {done ? '✓' : ''}
        </button>
      )
    }
    return (
      <button className="icon-btn" onClick={() => onLog(task)} aria-label={`Log ${task.title}`}>
        +
      </button>
    )
  }

  return (
    <>
      <div className={`row${view.skipped ? ' neutral' : ''}`}>
        <button
          className="body"
          onClick={() => onOpen(task.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'none' }}
        >
          <Ring fraction={fraction} color={task.colorHex} exceeded={exceeded}>
            {/* the day's count, the moment it is earned: 1, then 2, then 3 */}
            {status === 'complete' && streak > 0 ? <span className="num">{streak}</span> : null}
          </Ring>
          <span style={{ minWidth: 0 }}>
            <div className="title">{task.title}</div>
            <div className="meta">{meta()}</div>
          </span>
        </button>
        {action()}
      </div>
      {task.kind === 'quantity' && task.quickAdds.length > 0 && !view.skipped ? (
        <div className="quick-adds">
          {task.quickAdds.map((amount) => (
            <button key={amount} onClick={() => void store.logQuantity(task.id, amount, dayKey)}>
              +{amount}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}

function LogSheet({ task, dayKey, onClose }: { task: Task; dayKey: string; onClose: () => void }) {
  const store = useStore()
  const [value, setValue] = useState('')

  const submit = (): void => {
    const amount = Number(value)
    if (Number.isFinite(amount) && amount !== 0) void store.logQuantity(task.id, amount, dayKey)
    onClose()
  }

  return (
    <Sheet title={`Log ${task.title}`} onClose={onClose}>
      <div className="field">
        <label htmlFor="amount">Amount{task.unitLabel ? ` (${task.unitLabel})` : ''}</label>
        <input
          id="amount"
          type="number"
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <div className="sheet-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit}>
          Log
        </button>
      </div>
    </Sheet>
  )
}
