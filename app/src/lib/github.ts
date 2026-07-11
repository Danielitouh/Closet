// GitHub Contents API sync. Notes live ENCRYPTED under vault/ (see vault.ts);
// the vault settings blob lives at settings/vault.json. Strategy: pull-first,
// last-write-wins, with a conflict warning when both sides changed a note.

import type { StoredNote } from './store'
import { VAULT_DIR, VAULT_SETTINGS_PATH, type VaultRemote } from './vault'

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

/** Translates between local plaintext notes and encrypted remote files. */
export interface VaultCodec {
  filenameFor(title: string): Promise<string>
  encrypt(title: string, content: string): Promise<string>
  decrypt(body: string): Promise<{ title: string; content: string }>
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

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

interface RemoteFile {
  name: string
  path: string
  sha: string
}

// --- generic contents helpers -------------------------------------------------

async function listDir(cfg: SyncConfig, dir: string, ext: string): Promise<RemoteFile[]> {
  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(dir)}?ref=${encodeURIComponent(cfg.branch)}`,
    { headers: headers(cfg.token) },
  )
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`list ${dir} failed: HTTP ${res.status}`)
  const items = (await res.json()) as (RemoteFile & { type: string })[]
  return items.filter((i) => i.type === 'file' && i.name.toLowerCase().endsWith(ext))
}

async function fetchFile(
  cfg: SyncConfig,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}`,
    { headers: headers(cfg.token) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetch ${path} failed: HTTP ${res.status}`)
  const data = await res.json()
  return { content: b64decodeUtf8(data.content), sha: data.sha }
}

async function putFile(
  cfg: SyncConfig,
  path: string,
  content: string,
  message: string,
  sha: string | undefined,
): Promise<string> {
  const body: Record<string, unknown> = {
    message,
    content: b64encodeUtf8(content),
    branch: cfg.branch,
  }
  if (sha) body.sha = sha
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: headers(cfg.token),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`push ${path} failed: HTTP ${res.status}`)
  const data = await res.json()
  return data.content.sha as string
}

async function deleteFile(cfg: SyncConfig, path: string, message: string, sha: string): Promise<void> {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    headers: headers(cfg.token),
    body: JSON.stringify({ message, sha, branch: cfg.branch }),
  })
  if (!res.ok && res.status !== 404) throw new Error(`delete ${path} failed: HTTP ${res.status}`)
}

// --- vault settings blob ---------------------------------------------------------

export async function fetchVaultRemote(
  cfg: SyncConfig,
): Promise<{ remote: VaultRemote; sha: string } | null> {
  const file = await fetchFile(cfg, VAULT_SETTINGS_PATH)
  if (!file) return null
  try {
    return { remote: JSON.parse(file.content) as VaultRemote, sha: file.sha }
  } catch {
    return null
  }
}

export async function pushVaultRemote(
  cfg: SyncConfig,
  payload: VaultRemote,
  sha: string | undefined,
): Promise<string> {
  return putFile(cfg, VAULT_SETTINGS_PATH, JSON.stringify(payload, null, 2), 'wiki: vault settings', sha)
}

// --- encrypted note sync -----------------------------------------------------------

export interface SyncCallbacks {
  applyRemote: (title: string, content: string, sha: string) => Promise<void>
  markSynced: (title: string, sha: string) => Promise<void>
  removeLocal: (title: string) => Promise<void>
}

/**
 * Full two-way sync of encrypted notes.
 * - remote new/changed + local clean   -> pull (decrypt)
 * - remote changed + local dirty       -> conflict: local wins on push
 * - local dirty                        -> push (encrypt)
 * - local deletions (tracked by caller)-> delete remote
 * - remote deleted + local clean+synced-> remove local
 */
export async function syncAll(
  cfg: SyncConfig,
  codec: VaultCodec,
  notes: StoredNote[],
  pendingDeletes: string[],
  cb: SyncCallbacks,
): Promise<SyncResult> {
  const result: SyncResult = { pulled: [], pushed: [], deletedRemote: [], conflicts: [], errors: [] }
  const remote = await listDir(cfg, VAULT_DIR, '.enc')
  const remoteByFilename = new Map(remote.map((r) => [r.name, r]))

  const localByFilename = new Map<string, StoredNote>()
  for (const n of notes) {
    if (!n.test) localByFilename.set(await codec.filenameFor(n.title), n)
  }

  // Deletions made locally since last sync.
  for (const title of pendingDeletes) {
    const filename = await codec.filenameFor(title)
    const r = remoteByFilename.get(filename)
    if (r) {
      try {
        await deleteFile(cfg, `${VAULT_DIR}/${filename}`, 'wiki: delete note', r.sha)
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
    if (local && local.sha === r.sha) continue
    if (local && local.dirty) {
      result.conflicts.push(local.title) // both changed; local wins on push below
      continue
    }
    try {
      const file = await fetchFile(cfg, r.path)
      if (!file) continue
      const note = await codec.decrypt(file.content)
      await cb.applyRemote(note.title, note.content, file.sha)
      result.pulled.push(note.title)
    } catch (e) {
      result.errors.push(`${filename}: ${String(e)}`)
    }
  }

  // Remote deletions: local note was synced before but no longer exists remotely.
  for (const [filename, local] of localByFilename) {
    if (!remoteByFilename.has(filename) && local.sha && !local.dirty) {
      await cb.removeLocal(local.title)
    }
  }

  // Push local changes.
  for (const [filename, local] of localByFilename) {
    if (!local.dirty) continue
    try {
      const currentRemote = remoteByFilename.get(filename)
      const sha = currentRemote ? currentRemote.sha : local.sha
      const body = await codec.encrypt(local.title, local.content)
      const newSha = await putFile(cfg, `${VAULT_DIR}/${filename}`, body, 'wiki: update note', sha)
      await cb.markSynced(local.title, newSha)
      result.pushed.push(local.title)
    } catch (e) {
      result.errors.push(`${local.title}: ${String(e)}`)
    }
  }

  return result
}

// --- one-time migration of legacy plaintext /notes ------------------------------------

export interface MigrationResult {
  migrated: string[]
  errors: string[]
}

/**
 * Encrypt every legacy plaintext note under /notes into the vault, then
 * delete the plaintext files from the repo. Returns the migrated titles;
 * the caller applies them locally.
 */
export async function migrateLegacyNotes(
  cfg: SyncConfig,
  codec: VaultCodec,
  apply: (title: string, content: string, sha: string) => Promise<void>,
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: [], errors: [] }
  const legacy = await listDir(cfg, 'notes', '.md')
  for (const file of legacy) {
    try {
      const fetched = await fetchFile(cfg, file.path)
      if (!fetched) continue
      const title = file.name.replace(/\.md$/i, '')
      const filename = await codec.filenameFor(title)
      const body = await codec.encrypt(title, fetched.content)
      const existing = await fetchFile(cfg, `${VAULT_DIR}/${filename}`)
      const sha = await putFile(
        cfg,
        `${VAULT_DIR}/${filename}`,
        body,
        'wiki: migrate note to vault',
        existing?.sha,
      )
      await deleteFile(cfg, file.path, 'wiki: remove plaintext note (migrated to vault)', fetched.sha)
      await apply(title, fetched.content, sha)
      result.migrated.push(title)
    } catch (e) {
      result.errors.push(`${file.name}: ${String(e)}`)
    }
  }
  return result
}
