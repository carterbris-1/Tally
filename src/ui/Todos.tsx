import { useState } from 'react'
import type { Todo } from '../core/types'
import { groupByName } from '../core/grouping'
import { doneTodos, isOverdue, liveTasks, openTodos, todoGroupNames } from '../db/selectors'
import { useNow, useSnapshot, useStore } from './hooks'
import { GroupField } from './shared/GroupField'
import { Sheet } from './shared/Sheet'

/** One-off items. They never touch streaks — that separation is deliberate. */
export function Todos() {
  const s = useSnapshot()
  const store = useStore()
  const now = useNow()
  const [editing, setEditing] = useState<Todo | 'new' | null>(null)

  const open = openTodos(s)
  const overdue = open.filter((t) => isOverdue(t, now))
  const groups = groupByName(open.filter((t) => !isOverdue(t, now)))
  // a lone "Ungrouped" heading over everything is noise, not information
  const showHeadings = groups.length > 1 || (groups[0]?.key ?? '') !== ''
  const allDone = doneTodos(s)
  const done = allDone.slice(0, 20)

  return (
    <div className="wrap">
      <header className="screen-head">
        <h1>To-dos</h1>
        <span className="sub">{open.length} open</span>
      </header>

      {open.length === 0 && done.length === 0 ? (
        <div className="empty">
          <strong>Nothing to do</strong>
          One-off items live here. They never affect a streak.
        </div>
      ) : null}

      {overdue.length > 0 ? (
        <>
          <div className="section-label danger-text">Overdue</div>
          {overdue.map((t) => (
            <TodoRow key={t.id} todo={t} onEdit={setEditing} showGroup />
          ))}
        </>
      ) : null}

      {groups.map((group) => (
        <section key={group.key || 'ungrouped'}>
          {showHeadings ? (
            <div className="section-label">
              {group.label || 'Ungrouped'}
              <span style={{ opacity: 0.6 }}> · {group.items.length}</span>
            </div>
          ) : null}
          {group.items.map((t) => (
            <TodoRow key={t.id} todo={t} onEdit={setEditing} />
          ))}
        </section>
      ))}

      {done.length > 0 ? (
        <>
          <div className="section-label">Completed</div>
          {done.map((t) => (
            <TodoRow key={t.id} todo={t} onEdit={setEditing} showGroup />
          ))}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Cleared automatically after {s.settings.todoRetentionDays} days.
          </div>
        </>
      ) : null}

      <button className="fab" onClick={() => setEditing('new')} aria-label="New to-do">
        +
      </button>

      {editing ? (
        <TodoEditor todo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}

      {allDone.length > 0 ? (
        <button
          className="pill ghost"
          style={{ marginTop: 16 }}
          onClick={() => void store.clearCompletedTodos()}
        >
          Clear {allDone.length} completed
        </button>
      ) : null}
    </div>
  )
}

/** `showGroup` is for rows listed outside their group's heading: overdue and completed. */
function TodoRow({ todo, onEdit, showGroup = false }: { todo: Todo; onEdit: (t: Todo) => void; showGroup?: boolean }) {
  const s = useSnapshot()
  const store = useStore()
  const done = todo.completedAt !== null
  const linked = todo.linkedTaskId ? s.tasks.find((t) => t.id === todo.linkedTaskId) : null
  const group = showGroup ? (todo.group ?? '') : ''

  return (
    <div className="row" style={{ minHeight: 54 }}>
      <button
        className={`icon-btn${done ? ' done' : ''}`}
        onClick={() => void store.toggleTodo(todo.id)}
        aria-label={done ? 'Mark not done' : 'Mark done'}
      >
        {done ? '✓' : ''}
      </button>
      <button className="body" onClick={() => onEdit(todo)} style={{ background: 'none', textAlign: 'left' }}>
        <div className={`title${done ? ' strike' : ''}`}>
          {todo.isFlagged ? '⚑ ' : ''}
          {todo.title}
        </div>
        {group || todo.dueDate || linked || todo.notes ? (
          <div className="meta">
            {group ? `${group}${todo.dueDate || linked ? ' · ' : ''}` : null}
            {todo.dueDate ? new Date(todo.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null}
            {todo.dueDate && linked ? ' · ' : null}
            {linked ? `starts ${linked.title}` : null}
            {!group && !todo.dueDate && !linked && todo.notes ? todo.notes : null}
          </div>
        ) : null}
      </button>
    </div>
  )
}

function TodoEditor({ todo, onClose }: { todo: Todo | null; onClose: () => void }) {
  const s = useSnapshot()
  const store = useStore()
  const [title, setTitle] = useState(todo?.title ?? '')
  const [group, setGroup] = useState(todo?.group ?? '')
  const [notes, setNotes] = useState(todo?.notes ?? '')
  const [due, setDue] = useState(todo?.dueDate?.slice(0, 10) ?? '')
  const [flagged, setFlagged] = useState(todo?.isFlagged ?? false)
  const [linkedTaskId, setLinkedTaskId] = useState(todo?.linkedTaskId ?? '')

  const timerTasks = liveTasks(s).filter((t) => t.kind === 'timer')

  const save = (): void => {
    const trimmed = title.trim()
    if (!trimmed) return
    const patch = {
      title: trimmed,
      group,
      notes,
      dueDate: due ? new Date(`${due}T12:00:00`).toISOString() : null,
      isFlagged: flagged,
      linkedTaskId: linkedTaskId || null,
    }
    if (todo) void store.updateTodo(todo.id, patch)
    else void store.createTodo(patch)
    onClose()
  }

  return (
    <Sheet title={todo ? 'Edit to-do' : 'New to-do'} onClose={onClose}>
      <div className="field">
        <label htmlFor="t-title">Title</label>
        <input id="t-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <GroupField id="t-group" value={group} onChange={setGroup} existing={todoGroupNames(s)} />
      <div className="field">
        <label htmlFor="t-notes">Notes</label>
        <textarea id="t-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="t-due">Due date</label>
        <input id="t-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      {timerTasks.length > 0 ? (
        <div className="field">
          <label htmlFor="t-link">Checking this off starts</label>
          <select id="t-link" value={linkedTaskId} onChange={(e) => setLinkedTaskId(e.target.value)}>
            <option value="">Nothing</option>
            {timerTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <button className={`pill${flagged ? ' active' : ''}`} onClick={() => setFlagged(!flagged)}>
          ⚑ Priority
        </button>
      </div>
      <div className="sheet-actions">
        {todo ? (
          <button
            className="btn danger"
            onClick={() => {
              void store.deleteTodo(todo.id)
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
        <button className="btn" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  )
}
