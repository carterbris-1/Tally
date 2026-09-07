import { useEffect, useState } from 'react'
import { archivedTasks, orphans } from '../db/selectors'
import { getAll, putMany, type StoreName } from '../db/idb'
import { useNow, useSnapshot, useStore } from './hooks'
import { dayKeyFor } from '../core/dayKey'
import { formatDayKeyLong } from './format'
import { SyncPanel } from './SyncPanel'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const COLLECTIONS: StoreName[] = ['tasks', 'entries', 'todos', 'dayPlans', 'blocks', 'projects', 'phases']

const DEVICE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** The full IANA list where the browser offers it, a usable shortlist where it does not. */
function zoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const base =
    supported.length > 0
      ? supported
      : [
          'America/New_York',
          'America/Chicago',
          'America/Denver',
          'America/Los_Angeles',
          'America/Anchorage',
          'Pacific/Honolulu',
          'UTC',
          'Europe/London',
          'Europe/Berlin',
          'Asia/Tokyo',
          'Australia/Sydney',
        ]
  return [...new Set([current, DEVICE_ZONE, ...base])].filter(Boolean)
}

export function SettingsView() {
  const s = useSnapshot()
  const store = useStore()
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  const clockValue = `${String(Math.floor(s.settings.dayStartMinute / 60)).padStart(2, '0')}:${String(
    s.settings.dayStartMinute % 60,
  ).padStart(2, '0')}`

  const exportJson = async (): Promise<void> => {
    const data: Record<string, unknown> = { version: 1, exportedAt: new Date().toISOString(), settings: s.settings }
    for (const name of COLLECTIONS) data[name] = await getAll(name)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tally-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (file: File): Promise<void> => {
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>
      for (const name of COLLECTIONS) {
        const rows = data[name]
        if (Array.isArray(rows)) await putMany(name, rows)
      }
      if (data.settings) await store.updateSettings(data.settings as never)
      await store.load()
      setMessage('Imported. Rows with the same id were replaced.')
    } catch (err) {
      setMessage(`Import failed: ${String(err)}`)
    }
  }

  const dangling = orphans(s)
  const archived = archivedTasks(s)

  return (
    <div className="wrap">
      <header className="screen-head">
        <h1>Settings</h1>
      </header>

      <div className="section-label">Day</div>
      <div className="card" style={{ padding: 14 }}>
        <div className="field">
          <label htmlFor="day-start">Day starts at</label>
          <input
            id="day-start"
            type="time"
            value={clockValue}
            onChange={(e) => {
              const [h = '0', m = '0'] = e.target.value.split(':')
              void store.updateSettings({ dayStartMinute: Number(h) * 60 + Number(m) })
            }}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Activity before this time counts toward the previous day.
          </div>
        </div>
        <div className="field">
          <label htmlFor="tz">Time zone</label>
          <select
            id="tz"
            value={s.settings.timeZone}
            onChange={(e) => void store.updateSettings({ timeZone: e.target.value })}
          >
            {zoneOptions(s.settings.timeZone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
                {zone === DEVICE_ZONE ? ' — this device' : ''}
              </option>
            ))}
          </select>
          <ZoneClock />
        </div>
        <div className="field">
          <label htmlFor="week-start">Week starts on</label>
          <select
            id="week-start"
            value={s.settings.weekStartDay}
            onChange={(e) => void store.updateSettings({ weekStartDay: Number(e.target.value) })}
          >
            {DAY_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="skips">Skip days per month</label>
          <input
            id="skips"
            type="number"
            min={0}
            value={s.settings.skipDaysPerMonth ?? ''}
            placeholder="Unlimited"
            onChange={(e) =>
              void store.updateSettings({ skipDaysPerMonth: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Leave blank for unlimited. Skipped days are neutral — they neither complete nor
            break a streak.
          </div>
        </div>
      </div>

      <div className="section-label">Sync</div>
      <SyncPanel />

      <div className="section-label">Storage</div>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: 13.5, marginBottom: 10 }}>
          {persisted === true ? (
            <span className="on" style={{ color: 'var(--good)' }}>
              Storage is persistent. Safari will not evict this data.
            </span>
          ) : (
            <span>
              Safari clears browser storage for sites unused for a week. Installing Tally to
              your home screen exempts it — until then, export regularly.
            </span>
          )}
        </div>
        <div className="seg">
          {persisted !== true ? (
            <button
              className="pill"
              onClick={() => void navigator.storage?.persist?.().then((ok) => setPersisted(ok))}
            >
              Request persistent storage
            </button>
          ) : null}
          <button className="pill" onClick={() => void exportJson()}>
            Export JSON
          </button>
          <label className="pill" style={{ cursor: 'pointer' }}>
            Import JSON
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importJson(file)
              }}
            />
          </label>
        </div>
        {message ? <div className="muted" style={{ fontSize: 12.5, marginTop: 9 }}>{message}</div> : null}
      </div>

      <div className="section-label">To-dos</div>
      <div className="card" style={{ padding: 14 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="retention">Keep completed to-dos for (days)</label>
          <input
            id="retention"
            type="number"
            min={1}
            value={s.settings.todoRetentionDays}
            onChange={(e) => void store.updateSettings({ todoRetentionDays: Number(e.target.value) || 30 })}
          />
        </div>
      </div>

      {archived.length > 0 ? (
        <>
          <div className="section-label">Archived tasks</div>
          {archived.map((t) => (
            <div className="row" key={t.id} style={{ minHeight: 48 }}>
              <div className="body">
                <div className="title">{t.title}</div>
              </div>
              <button className="pill ghost" onClick={() => void store.updateTask(t.id, { isArchived: false })}>
                Restore
              </button>
            </div>
          ))}
        </>
      ) : null}

      {dangling.length > 0 ? (
        <>
          <div className="section-label">Orphaned entries</div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 13.5 }}>
              {dangling.length} {dangling.length === 1 ? 'entry points' : 'entries point'} at something
              that no longer exists. They are listed rather than deleted — a dropped hour you
              can see beats a double-counted one you cannot.
            </div>
          </div>
        </>
      ) : null}

      <div className="section-label">About</div>
      <div className="muted" style={{ fontSize: 12.5, paddingBottom: 20 }}>
        Tally keeps everything on this device. Elapsed time is derived from the moment you
        pressed start, so a running timer survives closing the tab, restarting the browser,
        and rebooting the phone.
      </div>
    </div>
  )
}

/**
 * Shows what the app currently believes the time and the day are.
 *
 * The day boundary is invisible until it is wrong, and by then it has already moved a
 * streak. This makes it checkable at a glance.
 */
function ZoneClock() {
  const s = useSnapshot()
  const store = useStore()
  const now = useNow()
  const zone = s.settings.timeZone

  const clock = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(now)

  const drift = zone !== DEVICE_ZONE

  return (
    <div className="muted" style={{ fontSize: 12, marginTop: 7, lineHeight: 1.6 }}>
      <div className="num">
        Now {clock} · counts toward{' '}
        <strong>{formatDayKeyLong(dayKeyFor(now, store.dayConfig))}</strong>
      </div>
      {drift ? (
        <div style={{ marginTop: 5 }}>
          This device is on {DEVICE_ZONE}. Tally is staying on {zone}, so travelling will
          not shift your history.{' '}
          <button
            className="link"
            style={{ background: 'none' }}
            onClick={() => void store.updateSettings({ timeZone: DEVICE_ZONE })}
          >
            Follow this device instead
          </button>
        </div>
      ) : null}
    </div>
  )
}
