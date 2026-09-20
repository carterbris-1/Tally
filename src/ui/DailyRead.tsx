import { useEffect, useState } from 'react'
import { useSnapshot, useStore } from './hooks'

const KIND_LABEL: Record<string, string> = { essay: 'Essay', article: 'Article', paper: 'Paper' }

/**
 * The day's one thing to read.
 *
 * Not a habit and not a streak — a feed, sitting alongside the tracker rather than
 * inside it. Skipping is a first-class action: a bad suggestion you cannot dismiss is
 * worse than no suggestion.
 */
export function DailyRead({ dayKey }: { dayKey: string }) {
  const s = useSnapshot()
  const store = useStore()
  const [busy, setBusy] = useState(false)
  const pick = store.readFor(dayKey)

  useEffect(() => {
    // fill forward whenever we are online; a no-op once the buffer is full
    if (navigator.onLine !== false) void store.fillReadBuffer()
  }, [store, dayKey])

  if (!pick) {
    return (
      <div className="read-card empty-read">
        <div className="muted" style={{ fontSize: 13 }}>
          Nothing picked yet — Tally fetches a few days ahead whenever it is online.
        </div>
        <button
          className="pill"
          style={{ marginTop: 9 }}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void store.fillReadBuffer().finally(() => setBusy(false))
          }}
        >
          {busy ? 'Looking…' : 'Try now'}
        </button>
      </div>
    )
  }

  const done = pick.finishedAt !== null

  return (
    <div className="read-card">
      <div className="read-head">
        <span className="kind">{KIND_LABEL[pick.kind] ?? pick.kind}</span>
        <span className="muted num">
          {pick.minutes} min{pick.year ? ` · ${pick.year}` : ''} · {pick.topic}
        </span>
      </div>
      <a
        className={`read-title${done ? ' strike' : ''}`}
        href={pick.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => void store.openRead(pick.id)}
      >
        {pick.title}
      </a>
      <div className="meta">{pick.author}</div>
      {pick.blurb ? <p className="read-blurb">{pick.blurb}</p> : null}
      <div className="seg" style={{ marginTop: 10 }}>
        <button
          className={`pill${done ? ' active' : ''}`}
          onClick={() => void store.updateRead(pick.id, { finishedAt: done ? null : new Date().toISOString() })}
        >
          {done ? '✓ Read' : 'Mark read'}
        </button>
        <button
          className={`pill${pick.savedAt ? ' active' : ''}`}
          onClick={() => void store.updateRead(pick.id, { savedAt: pick.savedAt ? null : new Date().toISOString() })}
        >
          {pick.savedAt ? '★ Saved' : 'Save'}
        </button>
        <button className="pill" onClick={() => void store.skipRead(pick.id)}>
          Skip
        </button>
      </div>
      {s.settings.readLinkedTaskId ? (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Opening this starts{' '}
          {s.tasks.find((t) => t.id === s.settings.readLinkedTaskId)?.title ?? 'your timer'}.
        </div>
      ) : null}
    </div>
  )
}
