import type { Task } from '../core/types'

const pad = (n: number): string => String(n).padStart(2, '0')

/** "1h 24m", "45m", "0m". For totals and goals. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return total > 0 ? `${total}s` : '0m'
}

/** "01:24:33". For a running timer, where the seconds matter. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export function formatAmount(task: Pick<Task, 'kind' | 'unitLabel'>, value: number): string {
  if (task.kind === 'timer') return formatDuration(value)
  const n = number.format(value)
  return task.unitLabel ? `${n} ${task.unitLabel}` : n
}

/** "of 30m", "of 1,500 cal", or nothing when the task just tracks. */
export function formatGoal(task: Task): string | null {
  if (task.kind === 'checkbox') return null
  if (task.goalValue === null || task.goalDirection === 'none') return null
  const verb = task.goalDirection === 'atMost' ? 'limit' : 'goal'
  return `${formatAmount(task, task.goalValue)} ${verb}`
}

/** Parse "1h 30m", "90m", "1:30", or a bare number of minutes. */
export function parseDurationToSeconds(input: string): number | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  const clock = /^(\d+):([0-5]?\d)$/.exec(text)
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60
  let seconds = 0
  let matched = false
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|minutes?|s|sec|seconds?)/g)) {
    const value = Number(m[1])
    const unit = m[2]!
    seconds += unit.startsWith('h') ? value * 3600 : unit.startsWith('m') ? value * 60 : value
    matched = true
  }
  if (matched) return Math.round(seconds)
  const bare = Number(text)
  return Number.isFinite(bare) ? Math.round(bare * 60) : null
}

export function formatDayKeyShort(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  )
}

export function formatDayKeyLong(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  )
}
