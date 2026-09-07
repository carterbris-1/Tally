import { useState } from 'react'
import { addDayKey } from '../core/dayKey'
import { BLOCK_GRANULARITY, MINUTES_PER_DAY } from '../core/repack'
import type { Block } from '../core/types'
import { blocksFor, planFor } from '../db/selectors'
import { formatDayKeyLong, formatDayMinute12, formatDuration } from './format'
import { useNow, useSnapshot, useStore } from './hooks'
import { Sheet } from './shared/Sheet'

const COLORS = ['#6366F1', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#8B5CF6']
const SLOT = BLOCK_GRANULARITY // 15 minutes
const SLOT_PX = 22 // one slot's height, so the grid reads proportionally

/** Planned times are always on the grid. Anything off it renders in the wrong row. */
const snap = (minute: number): number => Math.round(minute / SLOT) * SLOT

/**
 * The day plan is a canvas, not a list.
 *
 * The whole day is laid out as 15-minute slots. Tap one to start a block, tap a second
 * to stretch it across the range, name it. Nothing here starts a timer — a plan is what
 * you intend, and mixing intention with measurement was making both harder to read.
 */
export function Plan() {
  const s = useSnapshot()
  const store = useStore()
  const now = useNow()
  const cfg = store.dayConfig
  const [dayKey, setDayKey] = useState(() => store.todayKey(now))
  const [anchor, setAnchor] = useState<number | null>(null)
  const [creating, setCreating] = useState<{ start: number; minutes: number } | null>(null)
  const [editing, setEditing] = useState<Block | null>(null)

  const plan = planFor(s, dayKey)
  const blocks = plan ? [...blocksFor(s, plan.id)].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute) : []

  // where each block starts, and every slot any block occupies
  const byStart = new Map<number, Block>()
  const covered = new Set<number>()
  for (const b of blocks) {
    const start = snap(b.plannedStartMinute)
    byStart.set(start, b)
    for (let m = start; m < start + Math.max(SLOT, snap(b.plannedMinutes)); m += SLOT) covered.add(m)
  }

  const plannedTotal = blocks.reduce((sum, b) => sum + b.plannedMinutes, 0)
  const filledSlots = covered.size
  const selection = anchor === null ? null : { start: anchor, minutes: SLOT }

  const tapSlot = (minute: number): void => {
    if (anchor === null) {
      setAnchor(minute)
      return
    }
    const start = Math.min(anchor, minute)
    const end = Math.max(anchor, minute) + SLOT
    setAnchor(null)
    setCreating({ start, minutes: end - start })
  }

  const rows: React.ReactNode[] = []
  let m = 0
  while (m < MINUTES_PER_DAY) {
    const block = byStart.get(m)
    if (block) {
      const minutes = Math.max(SLOT, snap(block.plannedMinutes))
      rows.push(
        <button
          key={block.id}
          className="block-cell"
          style={{ height: (minutes / SLOT) * SLOT_PX - 2, borderLeftColor: block.colorHex }}
          onClick={() => setEditing(block)}
        >
          <span className="cell-title">
            {block.completedAt ? '✓ ' : ''}
            {block.title}
          </span>
          <span className="cell-meta num">{formatDuration(minutes * 60)}</span>
        </button>,
      )
      m += minutes
      continue
    }
    if (covered.has(m)) {
      m += SLOT
      continue
    }
    // `m` is a single mutable binding, so a closure over it would see the loop's final
    // value and every slot would plan the same minute. Capture per row.
    const minute = m
    rows.push(
      <button
        key={minute}
        className={`slot${anchor === minute ? ' anchored' : ''}${minute % 60 === 0 ? ' hour' : ''}`}
        style={{ height: SLOT_PX - 2 }}
        onClick={() => tapSlot(minute)}
        aria-label={`Plan ${formatDayMinute12(minute, cfg.dayStartMinute)}`}
      />,
    )
    m += SLOT
  }

  // the time gutter runs continuously, independent of how the rows are chunked
  const labels: React.ReactNode[] = []
  for (let t = 0; t < MINUTES_PER_DAY; t += 60) {
    labels.push(
      <div key={t} className="hour-label num" style={{ height: (60 / SLOT) * SLOT_PX }}>
        {formatDayMinute12(t, cfg.dayStartMinute)}
      </div>,
    )
  }

  return (
    <div className="wrap">
      <header className="screen-head">
        <h1>Day plan</h1>
        <span className="sub">{formatDayKeyLong(dayKey)}</span>
      </header>

      <div className="seg" style={{ marginBottom: 14 }}>
        <button className="pill" onClick={() => setDayKey(addDayKey(dayKey, -1))} aria-label="Previous day">
          ←
        </button>
        <button className="pill" onClick={() => setDayKey(store.todayKey(now))}>
          Today
        </button>
        <button className="pill" onClick={() => setDayKey(addDayKey(dayKey, 1))} aria-label="Next day">
          →
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="v num">{formatDuration(plannedTotal * 60)}</div>
          <div className="k">Planned</div>
        </div>
        <div className="stat">
          <div className="v num">{formatDuration((MINUTES_PER_DAY - filledSlots * SLOT) * 60)}</div>
          <div className="k">Unplanned</div>
        </div>
        <div className="stat">
          <div className="v num">
            {blocks.filter((b) => b.completedAt).length}/{blocks.length}
          </div>
          <div className="k">Done</div>
        </div>
      </div>

      {selection ? (
        <div className="running-bar">
          <div className="item">
            <span className="title num">{formatDayMinute12(selection.start, cfg.dayStartMinute)} selected</span>
            <button className="pill" onClick={() => setAnchor(null)}>
              Cancel
            </button>
            <button
              className="pill active"
              onClick={() => {
                setAnchor(null)
                setCreating({ start: selection.start, minutes: SLOT })
              }}
            >
              Name it
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Tap another slot to stretch the block to it.
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Tap an empty slot to start a block, then tap where it should end.
        </div>
      )}

      <div className="grid-day">
        <div className="gutter">{labels}</div>
        <div className="slots">{rows}</div>
      </div>

      {creating ? (
        <BlockSheet
          dayKey={dayKey}
          draft={creating}
          block={null}
          onClose={() => setCreating(null)}
        />
      ) : null}
      {editing ? (
        <BlockSheet dayKey={dayKey} draft={null} block={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  )
}

interface SheetProps {
  dayKey: string
  draft: { start: number; minutes: number } | null
  block: Block | null
  onClose: () => void
}

function BlockSheet({ dayKey, draft, block, onClose }: SheetProps) {
  const s = useSnapshot()
  const store = useStore()
  const cfg = store.dayConfig
  const [title, setTitle] = useState(block?.title ?? '')
  const [start, setStart] = useState(snap(block?.plannedStartMinute ?? draft?.start ?? 0))
  const [minutes, setMinutes] = useState(snap(block?.plannedMinutes ?? draft?.minutes ?? SLOT))
  const [color, setColor] = useState(block?.colorHex ?? COLORS[0]!)
  const [note, setNote] = useState(block?.note ?? '')

  const end = start + minutes
  const overflows = end > MINUTES_PER_DAY

  const save = async (): Promise<void> => {
    const trimmed = title.trim()
    if (!trimmed || overflows) return
    const patch = {
      title: trimmed,
      plannedStartMinute: start,
      plannedMinutes: Math.max(SLOT, minutes),
      colorHex: color,
      note,
      sortOrder: start, // start time is the order; nothing else needs to track it
    }
    if (block) await store.updateBlock(block.id, patch)
    else {
      const plan = planFor(s, dayKey) ?? (await store.ensurePlan(dayKey))
      await store.addBlock(plan.id, patch)
    }
    onClose()
  }

  return (
    <Sheet title={block ? 'Edit block' : 'New block'} onClose={onClose}>
      <div className="field">
        <label htmlFor="b-title">What is it?</label>
        <input
          id="b-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Study"
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </div>

      <div className="field">
        <label>
          {formatDayMinute12(start, cfg.dayStartMinute)} – {formatDayMinute12(end % MINUTES_PER_DAY, cfg.dayStartMinute)}
        </label>
        <div className="seg" style={{ alignItems: 'center' }}>
          <button
            className="pill"
            onClick={() => setMinutes(Math.max(SLOT, minutes - SLOT))}
            aria-label="Shorten by 15 minutes"
          >
            −15m
          </button>
          <span className="num" style={{ minWidth: 82, textAlign: 'center', fontWeight: 620 }}>
            {formatDuration(minutes * 60)}
          </span>
          <button className="pill" onClick={() => setMinutes(minutes + SLOT)} aria-label="Lengthen by 15 minutes">
            +15m
          </button>
        </div>
        <div className="seg" style={{ marginTop: 6 }}>
          {[30, 60, 120, 240].map((m) => (
            <button key={m} className={`pill${minutes === m ? ' active' : ''}`} onClick={() => setMinutes(m)}>
              {formatDuration(m * 60)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Move start</label>
        <div className="seg" style={{ alignItems: 'center' }}>
          <button className="pill" onClick={() => setStart(Math.max(0, start - SLOT))} aria-label="Start 15 minutes earlier">
            −15m
          </button>
          <span className="num" style={{ minWidth: 82, textAlign: 'center', fontWeight: 620 }}>
            {formatDayMinute12(start, cfg.dayStartMinute)}
          </span>
          <button
            className="pill"
            onClick={() => setStart(Math.min(MINUTES_PER_DAY - SLOT, start + SLOT))}
            aria-label="Start 15 minutes later"
          >
            +15m
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="b-note">Note</label>
        <input id="b-note" value={note} onChange={(e) => setNote(e.target.value)} />
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
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: c,
                outline: color === c ? '2px solid var(--text)' : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </div>

      {block ? (
        <div className="field">
          <button
            className={`pill${block.completedAt ? ' active' : ''}`}
            onClick={() =>
              void store.updateBlock(block.id, {
                completedAt: block.completedAt ? null : new Date().toISOString(),
              })
            }
          >
            {block.completedAt ? '✓ Done' : 'Mark done'}
          </button>
        </div>
      ) : null}

      {overflows ? (
        <div className="danger-text" style={{ fontSize: 12.5, marginBottom: 10 }}>
          That runs past the end of the day. Shorten it or move the start earlier.
        </div>
      ) : null}

      <div className="sheet-actions">
        {block ? (
          <button
            className="btn danger"
            onClick={() => {
              void store.deleteBlock(block.id)
              onClose()
            }}
          >
            Delete
          </button>
        ) : (
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        )}
        <button className="btn" onClick={() => void save()}>
          Save
        </button>
      </div>
    </Sheet>
  )
}
