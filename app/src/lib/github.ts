// GitHub Contents API sync. The /notes folder of the configured repo is the
// remote copy of the wiki. Strategy: pull-first, last-write-wins, with a
// conflict warning when both sides changed the same note.

import { titleToFilename } from './parser'
import type { StoredNote } from './store'

export interface SyncConfig {
  token: string
  owner: string
  repo: string
  branch: string
}

export interface SyncResult {
  pulled: string[]
  pushed: string[]
  deletedRemote: string[]
  conflicts: string[]
  errors: string[]
}

const API = 'https://api.github.com'

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function b64encodeUtf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}

function b64decodeUtf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

interface RemoteFile {
  name: string
  path: string
  sha: string
}

async function listRemoteNotes(cfg: SyncConfig): Promise<RemoteFile[]> {
  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/contents/notes?ref=${encodeURIComponent(cfg.branch)}`,
    { headers: headers(cfg.token) },
  )
  if (res.status === 404) return [] // no notes folder yet
  if (!res.ok) throw new Error(`list notes failed: HTTP ${res.status}`)
  const items = (await res.json()) as RemoteFile[] & { type?: string }[]
  return (items as (RemoteFile & { type: string })[]).filter(
    (i) => i.type === 'file' && i.name.toLowerCase().endsWith('.md'),
  )
}

async function fetchRemoteNote(cfg: SyncConfig, path: string): Promise<{ content: string; sha: string }> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.branch)}`,
    { headers: headers(cfg.token) },
  )
  if (!res.ok) throw new Error(`fetch ${path} failed: HTTP ${res.status}`)
  const data = await res.json()
  return { content: b64decodeUtf8(data.content), sha: data.sha }
}

async function putRemoteNote(
  cfg: SyncConfig,
  filename: string,
  content: string,
  sha: string | undefined,
): Promise<string> {
  const path = `notes/${filename}`
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const body: Record<string, unknown> = {
    message: `wiki: update ${filename}`,
    content: b64encodeUtf8(content),
    branch: cfg.branch,
  }
  if (sha) body.sha = sha
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: headers(cfg.token),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`push ${filename} failed: HTTP ${res.status}`)
  const data = await res.json()
  return data.content.sha as string
}

async function deleteRemoteNote(cfg: SyncConfig, filename: string, sha: string): Promise<void> {
  const path = `notes/${filename}`
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}`, {
    method: 'DELETE',
    headers: headers(cfg.token),
    body: JSON.stringify({ message: `wiki: delete ${filename}`, sha, branch: cfg.branch }),
  })
  if (!res.ok && res.status !== 404) throw new Error(`delete ${filename} failed: HTTP ${res.status}`)
}

export interface SyncCallbacks {
  applyRemote: (title: string, content: string, sha: string) => Promise<void>
  markSynced: (title: string, sha: string) => Promise<void>
  removeLocal: (title: string) => Promise<void>
}

/**
 * Full two-way sync.
 * - remote new/changed + local clean  -> pull
 * - remote changed + local dirty      -> conflict: local wins, warn
 * - local dirty                       -> push
 * - local deletions (tracked by caller) -> delete remote
 * - remote deleted + local clean+synced -> remove local
 */
export async function syncAll(
  cfg: SyncConfig,
  notes: StoredNote[],
  pendingDeletes: string[],
  cb: SyncCallbacks,
): Promise<SyncResult> {
  const result: SyncResult = { pulled: [], pushed: [], deletedRemote: [], conflicts: [], errors: [] }
  const remote = await listRemoteNotes(cfg)
  const remoteByFilename = new Map(remote.map((r) => [r.name, r]))
  const localByFilename = new Map(notes.filter((n) => !n.test).map((n) => [titleToFilename(n.title), n]))

  // Deletions made locally since last sync.
  for (const title of pendingDeletes) {
    const filename = titleToFilename(title)
    const r = remoteByFilename.get(filename)
    if (r) {
      try {
        await deleteRemoteNote(cfg, filename, r.sha)
        result.deletedRemote.push(title)
        remoteByFilename.delete(filename)
      } catch (e) {
        result.errors.push(String(e))
      }
    }
  }

  // Pull remote changes.
  for (const [filename, r] of remoteByFilename) {
    const local = localByFilename.get(filename)
    if (local && local.sha === r.sha) continue // in sync
    if (local && local.dirty && local.sha && local.sha !== r.sha) {
      result.conflicts.push(local.title) // both changed; local wins on push below
      continue
    }
    if (local && local.dirty && !local.sha) {
      // Never-synced local note collides with a remote one (e.g. bundled seed
      // edited before first sync): remote sha is adopted on push below.
      result.conflicts.push(local.title)
      continue
    }
    try {
      const { content, sha } = await fetchRemoteNote(cfg, r.path)
      const title = filename.replace(/\.md$/i, '')
      await cb.applyRemote(local ? local.title : title, content, sha)
      result.pulled.push(title)
    } catch (e) {
      result.errors.push(String(e))
    }
  }

  // Remote deletions: local note was synced before but no longer exists remotely.
  for (const [filename, local] of localByFilename) {
    if (!remoteByFilename.has(filename) && local.sha && !local.dirty) {
      await cb.removeLocal(local.title)
    }
  }

  // Push local changes (including conflict losers-turned-winners).
  for (const [filename, local] of localByFilename) {
    if (!local.dirty) continue
    try {
      const currentRemote = remoteByFilename.get(filename)
      const sha = currentRemote ? currentRemote.sha : local.sha
      const newSha = await putRemoteNote(cfg, filename, local.content, sha)
      await cb.markSynced(local.title, newSha)
      result.pushed.push(local.title)
    } catch (e) {
      result.errors.push(`${local.title}: ${String(e)}`)
    }
  }

  return result
}
