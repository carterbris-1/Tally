import { useState } from 'react'
import type { Phase, Project } from '../core/types'
import { groupedProjects, projectGroupNames, projectView, todosForPhase } from '../db/selectors'
import { useSnapshot, useStore } from './hooks'
import { Sheet } from './shared/Sheet'

export function Projects() {
  const s = useSnapshot()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const groups = groupedProjects(s)
  const total = groups.reduce((n, g) => n + g.items.filter((p) => !p.isArchived).length, 0)

  if (openId) return <ProjectDetail projectId={openId} onBack={() => setOpenId(null)} />

  // a lone "Ungrouped" heading over everything is noise, not information
  const showHeadings = groups.length > 1 || (groups[0]?.key ?? '') !== ''

  return (
    <div className="wrap">
      <header className="screen-head">
        <h1>Projects</h1>
        <span className="sub">{total} active</span>
      </header>

      {groups.length === 0 ? (
        <div className="empty">
          <strong>No projects</strong>
          Phased work with an hour estimate each. Progress is weighted by estimate, so a
          20h phase counts for more than a 2h one.
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.key || 'ungrouped'}>
          {showHeadings ? (
            <div className="section-label">
              {group.label || 'Ungrouped'}
              <span style={{ opacity: 0.6 }}> · {group.items.length}</span>
            </div>
          ) : null}
          {group.items.map((project) => {
            const v = projectView(s, project)
            return (
              <button
                key={project.id}
                className="row"
                style={{ display: 'block', opacity: project.isArchived ? 0.5 : 1 }}
                onClick={() => setOpenId(project.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span className="title">{project.title}</span>
                  <span className="num muted">{Math.round(v.progress * 100)}%</span>
                </div>
                <div className="meta">
                  {v.current ? `Now: ${v.current.title}` : 'All phases complete'}
                  {v.estimatedHours > 0 ? ` · ${v.estimatedHours}h estimated` : ''}
                </div>
                <div className="progress">
                  <i style={{ width: `${v.progress * 100}%`, background: project.colorHex }} />
                </div>
              </button>
            )
          })}
        </section>
      ))}

      <button className="fab" onClick={() => setCreating(true)} aria-label="New project">
        +
      </button>
      {creating ? <ProjectEditor project={null} onClose={() => setCreating(false)} /> : null}
    </div>
  )
}

function ProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const s = useSnapshot()
  const store = useStore()
  const [editingProject, setEditingProject] = useState(false)
  const [editingPhase, setEditingPhase] = useState<Phase | 'new' | null>(null)

  const project = s.projects.find((p) => p.id === projectId && !p.deletedAt)
  if (!project) {
    return (
      <div className="wrap">
        <button className="pill ghost" onClick={onBack}>
          ← Back
        </button>
        <div className="empty">This project no longer exists.</div>
      </div>
    )
  }
  const v = projectView(s, project)

  return (
    <div className="wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <button className="pill ghost" onClick={onBack}>
          ← Back
        </button>
        <button className="pill ghost" onClick={() => setEditingProject(true)}>
          Edit
        </button>
      </div>

      <header className="screen-head">
        <h1 style={{ fontSize: 22 }}>{project.title}</h1>
        <span className="sub num">{Math.round(v.progress * 100)}%</span>
      </header>
      <div className="progress" style={{ height: 6, marginBottom: 6 }}>
        <i style={{ width: `${v.progress * 100}%`, background: project.colorHex }} />
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>
        {project.group ? `${project.group} · ` : ''}
        Weighted by estimated hours{v.estimatedHours > 0 ? ` · ${v.estimatedHours}h total` : ''}
        {project.targetDate ? ` · target ${new Date(project.targetDate).toLocaleDateString()}` : ''}
      </div>
      {project.notes ? <p className="muted" style={{ fontSize: 13.5 }}>{project.notes}</p> : null}

      <div className="section-label">Phases</div>
      {v.phases.length === 0 ? <div className="empty">No phases yet.</div> : null}
      {v.phases.map((phase, i) => {
        const todos = todosForPhase(s, phase.id)
        const openTodos = todos.filter((t) => t.completedAt === null)
        const done = phase.completedAt !== null
        return (
          <div className="row" key={phase.id} style={{ alignItems: 'flex-start' }}>
            <button
              className={`icon-btn${done ? ' done' : ''}`}
              onClick={() => void store.togglePhase(phase.id)}
              aria-label={`Mark ${phase.title} ${done ? 'not done' : 'done'}`}
            >
              {done ? '✓' : i + 1}
            </button>
            <button
              className="body"
              onClick={() => setEditingPhase(phase)}
              style={{ background: 'none', textAlign: 'left' }}
            >
              <div className={`title${done ? ' strike' : ''}`}>{phase.title}</div>
              <div className="meta">
                {phase.estimatedHours > 0 ? `${phase.estimatedHours}h estimated` : 'No estimate'}
                {todos.length > 0 ? ` · ${todos.length - openTodos.length}/${todos.length} to-dos` : ''}
                {v.current?.id === phase.id ? ' · current' : ''}
              </div>
              {todos.length > 0 && openTodos.length === 0 && !done ? (
                <div className="link" style={{ fontSize: 12.5, marginTop: 4 }}>
                  All to-dos done — mark phase done?
                </div>
              ) : null}
            </button>
          </div>
        )
      })}

      <button className="pill" style={{ marginTop: 10 }} onClick={() => setEditingPhase('new')}>
        + Add phase
      </button>

      <div className="section-label">Danger zone</div>
      <div className="seg">
        <button className="pill" onClick={() => void store.updateProject(project.id, { isArchived: !project.isArchived })}>
          {project.isArchived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          className="pill"
          style={{ color: 'var(--bad)' }}
          onClick={() => {
            if (confirm(`Delete "${project.title}" and its phases?`)) {
              void store.deleteProject(project.id)
              onBack()
            }
          }}
        >
          Delete project
        </button>
      </div>

      {editingProject ? <ProjectEditor project={project} onClose={() => setEditingProject(false)} /> : null}
      {editingPhase ? (
        <PhaseEditor
          projectId={project.id}
          phase={editingPhase === 'new' ? null : editingPhase}
          onClose={() => setEditingPhase(null)}
        />
      ) : null}
    </div>
  )
}

function ProjectEditor({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const s = useSnapshot()
  const store = useStore()
  const [title, setTitle] = useState(project?.title ?? '')
  const [group, setGroup] = useState(project?.group ?? '')
  const [notes, setNotes] = useState(project?.notes ?? '')
  const [target, setTarget] = useState(project?.targetDate?.slice(0, 10) ?? '')

  const existing = projectGroupNames(s)
  const inGroup = (name: string): boolean => group.trim().toLocaleLowerCase() === name.toLocaleLowerCase()

  const save = (): void => {
    const trimmed = title.trim()
    if (!trimmed) return
    const patch = {
      title: trimmed,
      group,
      notes,
      targetDate: target ? new Date(`${target}T12:00:00`).toISOString() : null,
    }
    if (project) void store.updateProject(project.id, patch)
    else void store.createProject(patch)
    onClose()
  }

  return (
    <Sheet title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <div className="field">
        <label htmlFor="p-title">Title</label>
        <input id="p-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="p-group">Group</label>
        {existing.length > 0 ? (
          <div className="seg" style={{ marginBottom: 7 }}>
            <button className={`pill${group.trim() === '' ? ' active' : ''}`} onClick={() => setGroup('')}>
              None
            </button>
            {existing.map((name) => (
              <button
                key={name}
                className={`pill${inGroup(name) ? ' active' : ''}`}
                onClick={() => setGroup(name)}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <input
          id="p-group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="house, dev, travel…"
        />
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {existing.length > 0
            ? 'Tap one above, or type a new name. Capitalisation does not make a new group.'
            : 'Type a name to start a group. Others can join it later.'}
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-notes">Notes</label>
        <textarea id="p-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-target">Target date</label>
        <input id="p-target" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      <div className="sheet-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  )
}

function PhaseEditor({ projectId, phase, onClose }: { projectId: string; phase: Phase | null; onClose: () => void }) {
  const s = useSnapshot()
  const store = useStore()
  const [title, setTitle] = useState(phase?.title ?? '')
  const [hours, setHours] = useState(String(phase?.estimatedHours ?? ''))
  const [notes, setNotes] = useState(phase?.notes ?? '')

  const siblings = projectView(s, s.projects.find((p) => p.id === projectId)!).phases
  const index = phase ? siblings.findIndex((p) => p.id === phase.id) : -1

  const move = async (delta: number): Promise<void> => {
    if (!phase || index < 0) return
    const next = [...siblings]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    await store.reorderPhases(next.map((p) => p.id))
  }

  const save = (): void => {
    const trimmed = title.trim()
    if (!trimmed) return
    const patch = { title: trimmed, notes, estimatedHours: Number(hours) || 0 }
    if (phase) void store.updatePhase(phase.id, patch)
    else void store.addPhase(projectId, patch)
    onClose()
  }

  return (
    <Sheet title={phase ? 'Edit phase' : 'New phase'} onClose={onClose}>
      <div className="field">
        <label htmlFor="ph-title">Title</label>
        <input id="ph-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ph-hours">Estimated hours</label>
        <input
          id="ph-hours"
          type="number"
          inputMode="decimal"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="20"
        />
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Progress is weighted by this. Phases can be completed in any order.
        </div>
      </div>
      <div className="field">
        <label htmlFor="ph-notes">Notes</label>
        <textarea id="ph-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {phase ? (
        <div className="field">
          <label>Order</label>
          <div className="seg">
            <button className="pill" onClick={() => void move(-1)} disabled={index <= 0}>
              ↑ Earlier
            </button>
            <button className="pill" onClick={() => void move(1)} disabled={index >= siblings.length - 1}>
              ↓ Later
            </button>
          </div>
        </div>
      ) : null}
      <div className="sheet-actions">
        {phase ? (
          <button
            className="btn danger"
            onClick={() => {
              void store.deletePhase(phase.id)
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
