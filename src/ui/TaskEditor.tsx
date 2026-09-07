import { useState } from 'react'
import type { GoalDirection, Schedule, Task, TaskKind } from '../core/types'
import { formatAmount, formatDuration, parseDurationToSeconds } from './format'
import { useStore } from './hooks'
import { Sheet } from './shared/Sheet'

const COLORS = ['#6366F1', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#8B5CF6', '#EF4444', '#84CC16']
const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

interface Props {
  task: Task | null
  onClose: () => void
}

export function TaskEditor({ task, onClose }: Props) {
  const store = useStore()
  const [title, setTitle] = useState(task?.title ?? '')
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? 'timer')
  const [direction, setDirection] = useState<GoalDirection>(task?.goalDirection ?? 'atLeast')
  const [goalText, setGoalText] = useState(() => {
    if (task?.goalValue == null) return ''
    return task.kind === 'timer' ? formatDuration(task.goalValue) : String(task.goalValue)
  })
  const [unit, setUnit] = useState(task?.unitLabel ?? '')
  const [quickAdds, setQuickAdds] = useState((task?.quickAdds ?? []).join(', '))
  const [schedule, setSchedule] = useState<Schedule>(task?.schedule ?? { type: 'daily' })
  const [color, setColor] = useState(task?.colorHex ?? COLORS[0]!)

  const parsedGoal = (): number | null => {
    if (kind === 'checkbox' || direction === 'none') return null
    if (!goalText.trim()) return null
    return kind === 'timer' ? parseDurationToSeconds(goalText) : Number(goalText) || null
  }

  /**
   * A target-shaped task with no target is the worst of both worlds: it falls through to
   * "just track", where any activity at all completes the day and starts a streak. One
   * second of a timer used to earn a tick. The direction and the number arrive together
   * or not at all.
   */
  const parsed = parsedGoal()
  const needsGoal = kind !== 'checkbox' && direction !== 'none'
  const goalError = needsGoal && parsed === null
    ? goalText.trim()
      ? "That is not a number I can read. Try 30m, 1h 15m, or 90."
      : direction === 'atMost'
        ? 'Set the limit, or switch to "Just track".'
        : 'Set the target, or switch to "Just track".'
    : ''

  const save = (): void => {
    const trimmed = title.trim()
    if (!trimmed || goalError) return
    const patch = {
      title: trimmed,
      kind,
      goalDirection: kind === 'checkbox' ? ('atLeast' as const) : direction,
      goalValue: parsed,
      unitLabel: kind === 'quantity' ? unit.trim() : '',
      quickAdds:
        kind === 'quantity'
          ? quickAdds
              .split(/[,\s]+/)
              .map(Number)
              .filter((n) => Number.isFinite(n) && n > 0)
          : [],
      schedule,
      colorHex: color,
    }
    if (task) void store.updateTask(task.id, patch)
    else void store.createTask(patch)
    onClose()
  }

  const toggleWeekday = (day: number): void => {
    const days = schedule.type === 'weekdays' ? schedule.days : []
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort()
    setSchedule(next.length === 0 ? { type: 'daily' } : { type: 'weekdays', days: next })
  }

  return (
    <Sheet title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Read" />
      </div>

      <div className="field">
        <label>How is it measured?</label>
        <div className="seg">
          {(['timer', 'quantity', 'checkbox'] as const).map((k) => (
            <button key={k} className={`pill${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {k === 'timer' ? 'Timer' : k === 'quantity' ? 'Quantity' : 'Checkbox'}
            </button>
          ))}
        </div>
      </div>

      {kind !== 'checkbox' ? (
        <>
          <div className="field">
            <label>Goal</label>
            <div className="seg">
              {(
                [
                  ['atLeast', 'At least'],
                  ['atMost', 'At most'],
                  ['none', 'Just track'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={`pill${direction === value ? ' active' : ''}`}
                  onClick={() => setDirection(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {direction !== 'none' ? (
            <div className="field">
              <label htmlFor="goal">{kind === 'timer' ? 'Target (e.g. 30m, 1h 15m)' : 'Target amount'}</label>
              <input
                id="goal"
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder={kind === 'timer' ? '30m' : '1500'}
                inputMode={kind === 'timer' ? 'text' : 'decimal'}
                aria-invalid={goalError ? true : undefined}
              />
              {goalError ? (
                <div className="danger-text" style={{ fontSize: 12, marginTop: 6 }}>
                  {goalError}
                </div>
              ) : parsed !== null ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {direction === 'atMost' ? 'Limit: ' : 'Complete at '}
                  <strong>{formatAmount({ kind, unitLabel: unit }, parsed)}</strong>
                  {direction === 'atLeast' ? ' — not a minute sooner.' : ''}
                </div>
              ) : null}
              {direction === 'atMost' ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  A limit can only be called complete once the day ends. Going over marks the day
                  failed straight away.
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {kind === 'quantity' ? (
        <>
          <div className="field">
            <label htmlFor="unit">Unit label</label>
            <input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="cal, pages, reps" />
          </div>
          <div className="field">
            <label htmlFor="quick">Quick-add buttons</label>
            <input id="quick" value={quickAdds} onChange={(e) => setQuickAdds(e.target.value)} placeholder="250, 500" />
          </div>
        </>
      ) : null}

      <div className="field">
        <label>Schedule</label>
        <div className="seg">
          <button
            className={`pill${schedule.type === 'daily' ? ' active' : ''}`}
            onClick={() => setSchedule({ type: 'daily' })}
          >
            Every day
          </button>
          {DAY_NAMES.map((name, day) => (
            <button
              key={day}
              className={`pill${schedule.type === 'weekdays' && schedule.days.includes(day) ? ' active' : ''}`}
              onClick={() => toggleWeekday(day)}
              aria-label={`Day ${day}`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Colour</label>
        <div className="seg">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={c}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: c,
                outline: color === c ? '2px solid var(--text)' : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </div>

      <div className="sheet-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          onClick={save}
          disabled={Boolean(goalError) || !title.trim()}
          style={Boolean(goalError) || !title.trim() ? { opacity: 0.45 } : undefined}
        >
          {task ? 'Save' : 'Create'}
        </button>
      </div>
    </Sheet>
  )
}
