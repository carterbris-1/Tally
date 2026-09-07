/**
 * A thin promise wrapper over IndexedDB.
 *
 * Small enough not to justify a dependency, and versioned upgrades are the thing the
 * spec says to set up while the schema is still trivial.
 */

export const DB_NAME = 'tally'
export const DB_VERSION = 1

export const STORES = [
  'tasks',
  'entries',
  'todos',
  'dayPlans',
  'blocks',
  'projects',
  'phases',
  'meta',
] as const

export type StoreName = (typeof STORES)[number]

const INDEXES: Partial<Record<StoreName, Array<{ name: string; keyPath: string | string[] }>>> = {
  entries: [
    { name: 'byOwner', keyPath: ['ownerType', 'ownerId'] },
    { name: 'byDayKey', keyPath: 'dayKey' },
  ],
  blocks: [{ name: 'byPlan', keyPath: 'planId' }],
  phases: [{ name: 'byProject', keyPath: 'projectId' }],
  dayPlans: [{ name: 'byDayKey', keyPath: 'dayKey' }],
  todos: [{ name: 'byPhase', keyPath: 'phaseId' }],
}

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction!.objectStore(name)
          : db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' })
        for (const idx of INDEXES[name] ?? []) {
          if (!store.indexNames.contains(idx.name)) store.createIndex(idx.name, idx.keyPath)
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  })
  return dbPromise
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb()
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>)
}

export async function putMany(store: StoreName, rows: readonly unknown[]): Promise<void> {
  if (rows.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    for (const row of rows) os.put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  const row = await wrap(
    db.transaction('meta', 'readonly').objectStore('meta').get(key) as IDBRequest<{ key: string; value: T } | undefined>,
  )
  return row?.value
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await putMany('meta', [{ key, value }])
}

/** Hard delete. Used only for purging tombstones, never for user-facing deletes. */
export async function hardDelete(store: StoreName, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    for (const id of ids) os.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Empty every store. Backs "erase all data" and gives tests a clean slate. */
export async function clearAll(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...STORES], 'readwrite')
    for (const name of STORES) tx.objectStore(name).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
