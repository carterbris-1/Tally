/** Grouping projects under a name: "house", "dev", "travel". */

export interface Group<T> {
  /** Case-folded, for stable identity. Empty string means ungrouped. */
  key: string
  /** The spelling to display — the first one seen for this key. */
  label: string
  items: T[]
}

const UNGROUPED = ''

/** The case-folded identity of a group name. */
export const groupKey = (name: string): string => normalizeGroup(name).toLocaleLowerCase()

/**
 * Trimmed. "Ungrouped" in any case means no group: a real group by that name would
 * render a second, identical-looking "Ungrouped" heading next to the real one.
 */
export const normalizeGroup = (name: string): string => {
  const trimmed = name.trim()
  return trimmed.toLocaleLowerCase() === 'ungrouped' ? UNGROUPED : trimmed
}

/**
 * Group items by name, **case-insensitively**.
 *
 * "Dev" and "dev" are one group, not two. Free text invites that typo, and two groups
 * that look identical in a list is worse than no grouping at all. The first spelling
 * encountered wins the label, so the display stays whatever you typed first.
 *
 * Groups sort alphabetically; ungrouped items always come last, because they are the
 * pile you have not dealt with yet.
 */
export function groupByName<T extends { group?: string }>(items: readonly T[]): Array<Group<T>> {
  const groups = new Map<string, Group<T>>()

  for (const item of items) {
    const label = normalizeGroup(item.group ?? '')
    const key = groupKey(label)
    let group = groups.get(key)
    if (!group) {
      group = { key, label, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === UNGROUPED) return 1
    if (b.key === UNGROUPED) return -1
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
}

/** Existing group names, for the picker. Alphabetical, no duplicates, no blanks. */
export function groupNames<T extends { group?: string }>(items: readonly T[]): string[] {
  return groupByName(items)
    .filter((g) => g.key !== UNGROUPED)
    .map((g) => g.label)
}

/**
 * One display spelling per group key. Use it when items are split across lists (open,
 * overdue, completed) so every list spells a group the same way.
 */
export function groupLabels<T extends { group?: string }>(items: readonly T[]): Map<string, string> {
  return new Map(groupByName(items).map((g) => [g.key, g.label]))
}
