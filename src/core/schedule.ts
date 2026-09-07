import type { Schedule } from './types'
import { weekdayOf } from './dayKey'

/**
 * Is a task expected on this day?
 *
 * Unscheduled days are neutral: they neither complete nor break a streak.
 *
 * `timesPerWeek` reports every day as an opportunity. Its real evaluation — n days
 * anywhere in the week — is a week-level rule, not a day-level one, and lands in
 * v1.1 alongside the scheduling UI.
 */
export function isScheduled(schedule: Schedule, dayKey: string): boolean {
  switch (schedule.type) {
    case 'daily':
      return true
    case 'weekdays':
      return schedule.days.includes(weekdayOf(dayKey))
    case 'timesPerWeek':
      return true
  }
}

export function describeSchedule(schedule: Schedule): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  switch (schedule.type) {
    case 'daily':
      return 'Every day'
    case 'weekdays': {
      const days = [...schedule.days].sort((a, b) => a - b)
      if (days.length === 7) return 'Every day'
      return days.map((d) => names[d] ?? '?').join(', ')
    }
    case 'timesPerWeek':
      return `${schedule.n}× per week`
  }
}
