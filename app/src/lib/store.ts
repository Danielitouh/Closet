// IndexedDB persistence. The browser is the primary working copy; GitHub is
// the sync target. Two object stores: 'notes' (keyed by title) and 'meta'.

export interface StoredNote {
  title: string
  content: string
  /** Note has local changes not yet pushed to GitHub. */
  dirty: boolean
  /** GitHub blob sha of the last synced version (absent if never synced). */
  sha?: string
  /** Generated performance-test note; excluded from sync. */
  test?: boolean
  updatedAt: number
}

const DB_NAME = 'closet-wiki'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'title' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export function getAllNotes(): Promise<StoredNote[]> {
  return tx('notes', 'readonly', (s) => s.getAll() as IDBRequest<StoredNote[]>)
}

export function putNote(note: StoredNote): Promise<unknown> {
  return tx('notes', 'readwrite', (s) => s.put(note))
}

export function deleteNoteFromDB(title: string): Promise<unknown> {
  return tx('notes', 'readwrite', (s) => s.delete(title))
}

export function getMeta<T>(key: string): Promise<T | undefined> {
  return tx('meta', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
}

export function setMeta(key: string, value: unknown): Promise<unknown> {
  return tx('meta', 'readwrite', (s) => s.put(value, key))
}

// --- Seed notes -------------------------------------------------------------
// The repo's /notes folder is bundled into the app at build time, so a fresh
// browser starts with the wiki as of the last deploy; GitHub sync then brings
// it fully up to date.

const seedModules = import.meta.glob('../../../notes/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function getSeedNotes(): { title: string; content: string }[] {
  return Object.entries(seedModules).map(([path, content]) => ({
    title: decodeURIComponent(path.split('/').pop()!.replace(/\.md$/i, '')),
    content,
  }))
}
