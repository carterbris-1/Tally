import { describe, expect, it } from 'vitest'
import { groupByName, groupNames, normalizeGroup } from '../../src/core/grouping'

const p = (title: string, group?: string) => ({ title, ...(group === undefined ? {} : { group }) })

describe('groupByName', () => {
  it('gathers projects under their group', () => {
    const groups = groupByName([p('Deck', 'house'), p('Tally', 'dev'), p('Gutters', 'house')])
    expect(groups.map((g) => g.label)).toEqual(['dev', 'house'])
    expect(groups[1]?.items.map((x) => x.title)).toEqual(['Deck', 'Gutters'])
  })

  it('treats Dev and dev as one group, keeping the first spelling', () => {
    const groups = groupByName([p('Tally', 'Dev'), p('Site', 'dev'), p('CLI', 'DEV')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.label).toBe('Dev')
    expect(groups[0]?.items).toHaveLength(3)
  })

  it('ignores surrounding whitespace', () => {
    const groups = groupByName([p('Deck', 'house'), p('Gutters', '  house  ')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items).toHaveLength(2)
  })

  it('puts ungrouped last, however the field is missing', () => {
    const groups = groupByName([p('Loose'), p('Blank', ''), p('Spaces', '   '), p('Tally', 'dev')])
    expect(groups.map((g) => g.label)).toEqual(['dev', ''])
    expect(groups[1]?.items.map((x) => x.title)).toEqual(['Loose', 'Blank', 'Spaces'])
  })

  it('sorts groups alphabetically regardless of case', () => {
    const groups = groupByName([p('a', 'travel'), p('b', 'Dev'), p('c', 'house')])
    expect(groups.map((g) => g.label)).toEqual(['Dev', 'house', 'travel'])
  })

  it('preserves the order projects arrive in within a group', () => {
    const groups = groupByName([p('third', 'dev'), p('first', 'dev'), p('second', 'dev')])
    expect(groups[0]?.items.map((x) => x.title)).toEqual(['third', 'first', 'second'])
  })

  it('handles an empty list', () => {
    expect(groupByName([])).toEqual([])
  })
})

describe('groupNames', () => {
  it('lists the groups that exist, for the picker', () => {
    expect(groupNames([p('a', 'travel'), p('b', 'dev'), p('c', 'dev'), p('d')])).toEqual(['dev', 'travel'])
  })
})

describe('normalizeGroup', () => {
  it('trims but does not change case', () => {
    expect(normalizeGroup('  House ')).toBe('House')
    expect(normalizeGroup('')).toBe('')
  })
})
