import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TABLES } from '../../src/db/sync'

/**
 * The remote tables are created by hand, from a file, so nothing else notices when the
 * client starts syncing a collection the schema never creates. That gap is what broke
 * sync for daily_reads; this makes it a red build instead of a production error.
 */
describe('supabase/schema.sql', () => {
  it('creates every table sync uses, plus the reserved settings table', () => {
    const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
    const list = /foreach t in array array\[([^\]]*)\]/.exec(sql)?.[1]
    expect(list).toBeDefined()
    const inSchema = [...list!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    const synced = [...TABLES.map(([, table]) => table), 'settings'].sort()
    expect(inSchema).toEqual(synced)
  })
})
