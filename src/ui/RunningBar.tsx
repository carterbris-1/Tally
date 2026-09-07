import { sessionSeconds } from '../core/sessionSplit'
import type { Entry } from '../core/types'
import { formatClock } from './format'
import { useNow, useSnapshot, useStore } from './hooks'
import { runningEntries } from '../db/selectors'

/** Pinned to the top whenever anything is running. Multiple timers may run at once. */
export function RunningBar() {
  const s = useSnapshot()
  const store = useStore()
  const now = useNow()
  const running = runningEntries(s)
  if (running.length === 0) return null

  const label = (e: Entry): string => {
    if (e.ownerType === 'task') return s.tasks.find((t) => t.id === e.ownerId)?.title ?? 'Task'
    if (e.ownerType === 'block') return s.blocks.find((b) => b.id === e.ownerId)?.title ?? 'Block'
    return s.phases.find((p) => p.id === e.ownerId)?.title ?? 'Phase'
  }

  return (
    <div className="running-bar">
      {running.map((e) => (
        <div className="item" key={e.id}>
          <span className="dot" />
          <span className="title">{label(e)}</span>
          <span className="clock num">{formatClock(sessionSeconds(e.startedAt, e.endedAt, now))}</span>
          <button className="pill" onClick={() => void store.stopTimer(e.id)}>
            Stop
          </button>
        </div>
      ))}
    </div>
  )
}
