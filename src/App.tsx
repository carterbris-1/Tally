import { useState } from 'react'
import type { Task } from './core/types'
import { useSnapshot } from './ui/hooks'
import { Plan } from './ui/Plan'
import { Projects } from './ui/Projects'
import { SettingsView } from './ui/SettingsView'
import { TaskDetail } from './ui/TaskDetail'
import { TaskEditor } from './ui/TaskEditor'
import { Today } from './ui/Today'
import { Todos } from './ui/Todos'

type Tab = 'today' | 'todos' | 'plan' | 'projects' | 'settings'

const TABS: Array<{ id: Tab; label: string; glyph: string }> = [
  { id: 'today', label: 'Today', glyph: '◎' },
  { id: 'todos', label: 'To-dos', glyph: '✓' },
  { id: 'plan', label: 'Plan', glyph: '▤' },
  { id: 'projects', label: 'Projects', glyph: '◈' },
  { id: 'settings', label: 'Settings', glyph: '⚙' },
]

export function App() {
  const s = useSnapshot()
  const [tab, setTab] = useState<Tab>('today')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | 'new' | null>(null)

  const screen = (): React.ReactNode => {
    if (tab === 'today') {
      if (detailId) {
        return <TaskDetail taskId={detailId} onBack={() => setDetailId(null)} onEdit={setEditing} />
      }
      return <Today onOpenTask={setDetailId} onNewTask={() => setEditing('new')} />
    }
    if (tab === 'todos') return <Todos />
    if (tab === 'plan') return <Plan />
    if (tab === 'projects') return <Projects />
    return <SettingsView />
  }

  return (
    <div className="app">
      <main className="content">{s.ready ? screen() : <div className="empty">Loading…</div>}</main>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id}
            onClick={() => {
              setTab(t.id)
              if (t.id === 'today') setDetailId(null)
            }}
          >
            <span className="glyph" aria-hidden>
              {t.glyph}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {editing ? (
        <TaskEditor task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  )
}
