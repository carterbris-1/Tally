/**
 * Day-key derivation.
 *
 * A "tally day" runs from `dayStartMinute` local time to the same time the next
 * calendar day, so TV watched at 12:30am lands on the day it belongs to. Every
 * aggregation keys off the resulting "YYYY-MM-DD" string rather than doing range
 * math over instants.
 *
 * Everything here is civil-date arithmetic on fields already localised by Intl.
 * That is what makes it survive DST and timezone travel: we never add 24h to an
 * instant and hope.
 */

export interface CivilDate {
  year: number
  month: number // 1-12
  day: number // 1-31
}

export interface CivilTime extends CivilDate {
  hour: number
  minute: number
  second: number
}

export interface DayConfig {
  dayStartMinute: number // 0-1439, minutes past local midnight
  timeZone: string // IANA
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Wall-clock fields for an instant in a timezone. */
export function zonedParts(instant: Date | number, timeZone: string): CivilTime {
  const ts = typeof instant === 'number' ? instant : instant.getTime()
  const parts = formatterFor(timeZone).formatToParts(new Date(ts))
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type)
    return p ? Number(p.value) : 0
  }
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // h23 can legitimately report 24 for midnight in some ICU builds
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/** Milliseconds to add to UTC to get local wall clock at that instant. */
function tzOffsetMs(ts: number, timeZone: string): number {
  const sec = Math.floor(ts / 1000) * 1000
  const p = zonedParts(sec, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - sec
}

/**
 * The instant at which a wall-clock time occurs in a timezone.
 *
 * Two-pass, because the offset depends on the answer. Ambiguous times (the hour
 * repeated when clocks go back) resolve to the first occurrence; times that do not
 * exist (the hour skipped when clocks go forward) resolve to the instant just after
 * the gap. Both are documented choices, not accidents.
 */
export function civilToInstant(c: CivilTime, timeZone: string): Date {
  const target = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second)
  const guess = target - tzOffsetMs(target, timeZone)
  return new Date(target - tzOffsetMs(guess, timeZone))
}

/** Civil-date arithmetic. No timezone involved, so no DST to get wrong. */
export function addCivilDays(d: CivilDate, n: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + n * 86_400_000)
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

export function formatDayKey(d: CivilDate): string {
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`
}

export function parseDayKey(key: string): CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) throw new Error(`Invalid dayKey: ${key}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/** The tally day an instant belongs to. */
export function dayKeyFor(instant: Date | number, cfg: DayConfig): string {
  const p = zonedParts(instant, cfg.timeZone)
  const minuteOfDay = p.hour * 60 + p.minute
  const civil = minuteOfDay < cfg.dayStartMinute ? addCivilDays(p, -1) : p
  return formatDayKey(civil)
}

/**
 * When a tally day begins, as an instant.
 *
 * Resolved by wall clock, not by elapsed time: a block planned for 10:00 renders at
 * 10:00 on a spring-forward day too. The day is 23 hours long and its tail is
 * compressed, which is what a human means by "10am".
 */
export function dayStartInstant(dayKey: string, cfg: DayConfig): Date {
  const d = parseDayKey(dayKey)
  return civilToInstant(
    {
      ...d,
      hour: Math.floor(cfg.dayStartMinute / 60),
      minute: cfg.dayStartMinute % 60,
      second: 0,
    },
    cfg.timeZone,
  )
}

/** When a tally day ends — identical to the next day's start. */
export function dayEndInstant(dayKey: string, cfg: DayConfig): Date {
  return dayStartInstant(addDayKey(dayKey, 1), cfg)
}

/** Real elapsed length of a tally day. 23h or 25h across a DST transition. */
export function dayLengthMs(dayKey: string, cfg: DayConfig): number {
  return dayEndInstant(dayKey, cfg).getTime() - dayStartInstant(dayKey, cfg).getTime()
}

export function isDayEnded(dayKey: string, cfg: DayConfig, now: Date | number = Date.now()): boolean {
  const ts = typeof now === 'number' ? now : now.getTime()
  return ts >= dayEndInstant(dayKey, cfg).getTime()
}

export function addDayKey(key: string, n: number): string {
  return formatDayKey(addCivilDays(parseDayKey(key), n))
}

/** 0 = Sunday. Pure civil arithmetic, so it never drifts. */
export function weekdayOf(dayKey: string): number {
  const d = parseDayKey(dayKey)
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
}

/** Inclusive range of day keys, ascending. */
export function eachDayKey(fromKey: string, toKey: string): string[] {
  const out: string[] = []
  let cur = fromKey
  // guard against an inverted range rather than looping forever
  if (compareDayKeys(fromKey, toKey) > 0) return out
  while (compareDayKeys(cur, toKey) <= 0) {
    out.push(cur)
    cur = addDayKey(cur, 1)
  }
  return out
}

/** Lexicographic comparison is correct for zero-padded ISO dates. */
export function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Wall-clock instant for an offset in minutes since a day's start.
 *
 * Used by the planner to resolve `plannedStartMinute`. Civil arithmetic again:
 * minute 360 on a 23-hour day is still 10:00, not 11:00.
 */
export function instantForDayMinute(dayKey: string, minute: number, cfg: DayConfig): Date {
  const total = cfg.dayStartMinute + minute
  const d = addCivilDays(parseDayKey(dayKey), Math.floor(total / 1440))
  const rem = ((total % 1440) + 1440) % 1440
  return civilToInstant(
    { ...d, hour: Math.floor(rem / 60), minute: rem % 60, second: 0 },
    cfg.timeZone,
  )
}

/** "04:00" for 240. Rendering helper. */
export function formatDayMinute(minute: number, cfg: DayConfig): string {
  const total = ((cfg.dayStartMinute + minute) % 1440 + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}
