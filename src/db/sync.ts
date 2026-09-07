/**
 * Cross-device sync.
 *
 * One user, two devices, rarely editing the same row at the same moment. That shape
 * makes last-write-wins per row the right answer and a CRDT engineering for a problem
 * that does not exist. Every row carries `updatedAt`; the later one wins.
 *
 * Offline is the normal case, not an error state. A failed pass logs, keeps its
 * watermark, and tries again. It never blocks a write and never shows a modal.
 */

import { getAll, getMeta, putMany, setMeta, type StoreName } from './idb'
import { store } from './store'
import { supabase, isSyncConfigured } from './supabase'

/** Local collection -> remote table. */
const TABLES: Array<[StoreName, string]> = [
  ['tasks', 'tasks'],
  ['entries', 'entries'],
  ['todos', 'todos'],
  ['dayPlans', 'day_plans'],
  ['blocks', 'blocks'],
  ['projects', 'projects'],
  ['phases', 'phases'],
]

interface Syncable {
  id: string
  updatedAt: string
  deletedAt: string | null
}

interface RemoteRow {
  id: string
  updated_at: string
  deleted_at: string | null
  data: Syncable
}

const PULL_KEY = 'sync:lastPulledAt'
const PUSH_KEY = 'sync:lastPushedAt'
const EPOCH = '1970-01-01T00:00:00.000Z'

export interface SyncResult {
  pushed: number
  pulled: number
  at: string
}

export type SyncState =
  | { status: 'off' }
  | { status: 'signedOut' }
  | { status: 'idle'; last: SyncResult | null }
  | { status: 'syncing' }
  | { status: 'error'; message: string }

let state: SyncState = isSyncConfigured ? { status: 'signedOut' } : { status: 'off' }
const listeners = new Set<() => void>()

export const subscribeToSync = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getSyncState = (): SyncState => state

const setState = (next: SyncState): void => {
  state = next
  for (const fn of listeners) fn()
}

let running: Promise<void> | null = null

/**
 * One pass: push what changed locally, pull what changed remotely, advance both
 * watermarks from the server's clock rather than this device's.
 */
export async function sync(): Promise<void> {
  const client = supabase()
  if (!client) return
  if (running) return running

  running = (async () => {
    const { data: auth } = await client.auth.getUser()
    const userId = auth.user?.id
    if (!userId) {
      setState({ status: 'signedOut' })
      return
    }

    setState({ status: 'syncing' })
    try {
      const lastPushedAt = (await getMeta<string>(PUSH_KEY)) ?? EPOCH
      const lastPulledAt = (await getMeta<string>(PULL_KEY)) ?? EPOCH
      let pushed = 0
      let pulled = 0
      let newestPushed = lastPushedAt
      let newestPulled = lastPulledAt

      for (const [collection, table] of TABLES) {
        // ---- push
        const local = await getAll<Syncable>(collection)
        const dirty = local.filter((r) => r.updatedAt > lastPushedAt)
        if (dirty.length > 0) {
          const payload = dirty.map((r) => ({
            id: r.id,
            user_id: userId,
            updated_at: r.updatedAt,
            deleted_at: r.deletedAt,
            data: r,
          }))
          const { error } = await client.from(table).upsert(payload, { onConflict: 'id' })
          if (error) throw new Error(`${table}: ${error.message}`)
          pushed += dirty.length
          for (const r of dirty) if (r.updatedAt > newestPushed) newestPushed = r.updatedAt
        }

        // ---- pull
        const { data: remote, error: pullError } = await client
          .from(table)
          .select('id, updated_at, deleted_at, data')
          .gt('updated_at', lastPulledAt)
          .order('updated_at', { ascending: true })
        if (pullError) throw new Error(`${table}: ${pullError.message}`)

        const rows = (remote ?? []) as RemoteRow[]
        if (rows.length > 0) {
          const byId = new Map(local.map((r) => [r.id, r]))
          const winners = rows
            .map((row) => ({ ...row.data, id: row.id, updatedAt: row.updated_at, deletedAt: row.deleted_at }))
            .filter((incoming) => {
              const mine = byId.get(incoming.id)
              return !mine || incoming.updatedAt > mine.updatedAt
            })
          if (winners.length > 0) await putMany(collection, winners)
          pulled += winners.length
          const newest = rows[rows.length - 1]!.updated_at
          if (newest > newestPulled) newestPulled = newest
        }
      }

      await setMeta(PUSH_KEY, newestPushed)
      await setMeta(PULL_KEY, newestPulled)
      if (pulled > 0) await store.load()

      setState({ status: 'idle', last: { pushed, pulled, at: new Date().toISOString() } })
    } catch (err) {
      // Offline is expected, not exceptional. Keep the watermarks and try later.
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })().finally(() => {
    running = null
  })

  return running
}

let timer: ReturnType<typeof setInterval> | null = null

/** On load, on focus, and every 60s while the tab is visible. */
export function startSyncLoop(): void {
  if (!isSyncConfigured || timer !== null) return
  void sync()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void sync()
  }, 60_000)
  window.addEventListener('focus', () => void sync())
  window.addEventListener('online', () => void sync())
}

/**
 * Email and password, not magic links.
 *
 * A magic link costs one email per sign-in, and Supabase's free tier allows roughly two
 * an hour. Signing in on a second device, or mistyping a redirect URL once, exhausts
 * that. A password costs nothing per use, needs no redirect allow-list, and the phone's
 * keychain types it for you. For a single-user tracker that is the whole trade.
 *
 * Returns an empty string on success, or a message to show.
 */
export async function signIn(email: string, password: string): Promise<string> {
  const client = supabase()
  if (!client) return 'Sync is not configured on this build.'
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) return error.message
  void sync()
  return ''
}

// There is deliberately no signUp here. This is a one-person tracker: the account is
// created once, by hand, in the Supabase dashboard with "Auto Confirm User" ticked.
// Removing the path means the app cannot accidentally create a second account — though
// see the note in SyncPanel about what this does and does not protect.

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut()
  // A different account must not inherit this one's watermarks.
  await setMeta(PULL_KEY, EPOCH)
  await setMeta(PUSH_KEY, EPOCH)
  setState({ status: 'signedOut' })
}

export async function currentEmail(): Promise<string | null> {
  const { data } = (await supabase()?.auth.getUser()) ?? { data: { user: null } }
  return data.user?.email ?? null
}
