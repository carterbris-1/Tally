/**
 * Free-text group with the existing names offered as pills, so a typo cannot fork a
 * group. Shared by the project and to-do editors.
 */
export function GroupField({
  id,
  value,
  onChange,
  existing,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  existing: readonly string[]
}) {
  const inGroup = (name: string): boolean => value.trim().toLocaleLowerCase() === name.toLocaleLowerCase()

  return (
    <div className="field">
      <label htmlFor={id}>Group</label>
      {existing.length > 0 ? (
        <div className="seg" style={{ marginBottom: 7 }}>
          <button className={`pill${value.trim() === '' ? ' active' : ''}`} onClick={() => onChange('')}>
            None
          </button>
          {existing.map((name) => (
            <button key={name} className={`pill${inGroup(name) ? ' active' : ''}`} onClick={() => onChange(name)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="house, dev, travel…" />
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {existing.length > 0
          ? 'Tap one above, or type a new name. Capitalisation does not make a new group.'
          : 'Type a name to start a group. Others can join it later.'}
      </div>
    </div>
  )
}
