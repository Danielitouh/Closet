import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GraphView, { DEFAULT_PHYSICS, GraphViewHandle, PhysicsSettings, tagColor } from './components/GraphView'
import NotePanel from './components/NotePanel'
import SearchModal from './components/SearchModal'
import SecurityGate from './components/SecurityGate'
import SettingsModal from './components/SettingsModal'
import { buildGraph, localSubgraph } from './lib/graphData'
import {
  fetchVaultRemote,
  migrateLegacyNotes,
  pushVaultRemote,
  syncAll,
  SyncConfig,
  VaultCodec,
} from './lib/github'
import { normalizeTitle } from './lib/parser'
import { loadTwoStepConfig, saveTwoStepConfig, unlockTwoStep, verifyTotp } from './lib/twoStep'
import {
  createVault,
  decryptNote,
  encryptNote,
  isTombstone,
  loadVaultConfig,
  reconcileVault,
  saveVaultConfig,
  unlockVault,
  vaultFilename,
  type VaultConfig,
} from './lib/vault'
import {
  deleteNoteFromDB,
  getAllNotes,
  getMeta,
  putNote,
  setMeta,
  StoredNote,
} from './lib/store'

const CONFIG_KEY = 'closet-wiki-sync-config'

function loadConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* fresh start */ }
  return { token: '', owner: 'Danielitouh', repo: 'Closet', branch: 'main' }
}

export default function App() {
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(loadVaultConfig)
  // Locked when either the new vault or a legacy two-step enrollment exists.
  const [unlocked, setUnlocked] = useState(() => !loadVaultConfig() && !loadTwoStepConfig())
  const vaultKeyRef = useRef<CryptoKey | null>(null)
  const [notes, setNotes] = useState<Map<string, StoredNote>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [focusDepth, setFocusDepth] = useState<number | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS)
  const [hiddenTags, setHiddenTags] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('closet-wiki-hidden-sections') ?? '[]'))
    } catch {
      return new Set()
    }
  })
  const [showGhosts, setShowGhosts] = useState(true)

  const setHiddenSections = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setHiddenTags((prev) => {
      const next = updater(prev)
      localStorage.setItem('closet-wiki-hidden-sections', JSON.stringify([...next]))
      return next
    })
  }, [])
  const [config, setConfig] = useState<SyncConfig>(loadConfig)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncInfo, setLastSyncInfo] = useState('Never synced in this browser.')
  const [toast, setToast] = useState<string | null>(null)

  const graphRef = useRef<GraphViewHandle>(null)
  const pendingDeletes = useRef<string[]>([])
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000)
  }, [])

  // --- Initial load ---------------------------------------------------------
  // No bundled seeds: the deployed site starts empty and notes only appear
  // after this browser unlocks the vault and syncs. Nothing readable ships.
  useEffect(() => {
    if (!unlocked) return
    ;(async () => {
      const stored = await getAllNotes()
      pendingDeletes.current = (await getMeta<string[]>('pendingDeletes')) ?? []
      setNotes(new Map(stored.map((n) => [n.title, n])))
      setLoaded(true)
    })()
  }, [unlocked])

  // Vault adoption (runs on mount, before unlock): a device with a sync token
  // but no local vault checks the repo for one enrolled on another device and
  // locks itself to it. A remote vault SUPERSEDES any local legacy two-step
  // enrollment — so a device that only had the old two-step adopts the new
  // encrypted vault instead of creating a conflicting one on unlock (which
  // would overwrite the other device's vault and orphan its notes).
  useEffect(() => {
    if (loadVaultConfig()) return // already locked to a vault locally
    const cfg = loadConfig()
    if (!cfg.token) return
    void (async () => {
      try {
        const remote = await fetchVaultRemote(cfg)
        if (remote && !isTombstone(remote.remote)) {
          saveVaultConfig(remote.remote)
          saveTwoStepConfig(null) // remote vault wins over any local legacy lock
          setVaultConfig(remote.remote)
          setUnlocked(false)
          showToast('This wiki is protected — unlock with your vault password.')
        }
      } catch {
        // Offline or no access: stay usable locally.
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Note mutations --------------------------------------------------------
  const upsertNote = useCallback((title: string, content: string, extra?: Partial<StoredNote>) => {
    setNotes((prev) => {
      const next = new Map(prev)
      const existing = prev.get(title)
      const note: StoredNote = {
        title,
        content,
        dirty: true,
        sha: existing?.sha,
        updatedAt: Date.now(),
        ...extra,
      }
      next.set(title, note)
      void putNote(note)
      return next
    })
  }, [])

  const scheduleAutoSync = useCallback(() => {
    if (!config.token) return
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => void doSync(), 4000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.token])

  const changeNote = useCallback(
    (title: string, content: string) => {
      upsertNote(title, content)
      scheduleAutoSync()
    },
    [upsertNote, scheduleAutoSync],
  )

  const createNote = useCallback(
    (title: string) => {
      const t = title.trim()
      if (!t) return
      const existing = [...notesRef.current.values()].find(
        (n) => normalizeTitle(n.title) === normalizeTitle(t),
      )
      if (!existing) {
        upsertNote(t, `# ${t}\n\n`)
        scheduleAutoSync()
      }
      setSelected(existing ? existing.title : t)
      setSearchOpen(false)
    },
    [upsertNote, scheduleAutoSync],
  )

  // Create a note without navigating away (used by the editor's [[link]] picker).
  const createNoteBackground = useCallback(
    (title: string) => {
      const t = title.trim()
      if (!t) return
      const exists = [...notesRef.current.values()].some(
        (n) => normalizeTitle(n.title) === normalizeTitle(t),
      )
      if (!exists) {
        upsertNote(t, `# ${t}\n\n`)
        scheduleAutoSync()
        showToast(`Created "${t}"`)
      }
    },
    [upsertNote, scheduleAutoSync, showToast],
  )

  const deleteNote = useCallback(
    (title: string) => {
      setNotes((prev) => {
        const next = new Map(prev)
        const note = prev.get(title)
        next.delete(title)
        void deleteNoteFromDB(title)
        if (note && !note.test) {
          pendingDeletes.current.push(title)
          void setMeta('pendingDeletes', pendingDeletes.current)
        }
        return next
      })
      setSelected(null)
      scheduleAutoSync()
    },
    [scheduleAutoSync],
  )

  // --- Sync -------------------------------------------------------------------
  const doSync = useCallback(async () => {
    const cfg = loadConfig()
    if (!cfg.token) {
      showToast('Add a GitHub token in Settings to sync.')
      return
    }
    const key = vaultKeyRef.current
    const localVault = loadVaultConfig()
    if (!key || !localVault) {
      showToast('Set a vault password in Settings — sync only runs end-to-end encrypted.')
      return
    }
    const codec: VaultCodec = {
      filenameFor: (title) => vaultFilename(title),
      encrypt: (title, content) => encryptNote(key, title, content),
      decrypt: (body) => decryptNote(key, body),
    }
    setSyncing(true)
    try {
      // 1. Reconcile vault settings across devices.
      const remoteVault = await fetchVaultRemote(cfg)
      const action = reconcileVault(localVault, remoteVault?.remote ?? null)
      if (action === 'push-local') {
        await pushVaultRemote(cfg, localVault, remoteVault?.sha)
      } else if (action === 'adopt-remote' && remoteVault && !isTombstone(remoteVault.remote)) {
        if (remoteVault.remote.wrappedKey !== localVault.wrappedKey) {
          // A different enrollment exists elsewhere and is newer: adopt it and
          // require a fresh unlock — our in-memory key no longer matches.
          saveVaultConfig(remoteVault.remote)
          setVaultConfig(remoteVault.remote)
          vaultKeyRef.current = null
          setSyncing(false)
          showToast('Security settings changed on another device — unlock again.')
          lockNow()
          return
        }
        saveVaultConfig(remoteVault.remote)
        setVaultConfig(remoteVault.remote)
      } else if (action === 'delete-local') {
        saveVaultConfig(null)
        setVaultConfig(null)
        vaultKeyRef.current = null
        setSyncing(false)
        showToast('Vault was disabled from another device. Sync is paused.')
        return
      }

      // 2. One-time migration: encrypt any legacy plaintext /notes into the vault.
      const migration = await migrateLegacyNotes(cfg, codec, async (title, content, sha) => {
        setNotes((prev) => {
          const next = new Map(prev)
          const note: StoredNote = { title, content, dirty: false, sha, updatedAt: Date.now() }
          next.set(title, note)
          void putNote(note)
          return next
        })
      })
      if (migration.migrated.length) {
        showToast(`Encrypted ${migration.migrated.length} notes into the vault. Plaintext removed from GitHub.`)
      }
      if (migration.errors.length) console.error('migration errors', migration.errors)

      // 3. Sync encrypted notes.
      const result = await syncAll(cfg, codec, [...notesRef.current.values()], pendingDeletes.current, {
        async applyRemote(title, content, sha) {
          setNotes((prev) => {
            const next = new Map(prev)
            const note: StoredNote = { title, content, dirty: false, sha, updatedAt: Date.now() }
            next.set(title, note)
            void putNote(note)
            return next
          })
        },
        async markSynced(title, sha) {
          setNotes((prev) => {
            const next = new Map(prev)
            const note = prev.get(title)
            if (note) {
              const updated = { ...note, dirty: false, sha }
              next.set(title, updated)
              void putNote(updated)
            }
            return next
          })
        },
        async removeLocal(title) {
          setNotes((prev) => {
            const next = new Map(prev)
            next.delete(title)
            void deleteNoteFromDB(title)
            return next
          })
        },
      })
      pendingDeletes.current = []
      void setMeta('pendingDeletes', [])
      const bits: string[] = []
      if (result.pulled.length) bits.push(`pulled ${result.pulled.length}`)
      if (result.pushed.length) bits.push(`pushed ${result.pushed.length}`)
      if (result.deletedRemote.length) bits.push(`deleted ${result.deletedRemote.length}`)
      if (result.conflicts.length) bits.push(`⚠ ${result.conflicts.length} conflict(s), local kept`)
      if (result.errors.length) bits.push(`❌ ${result.errors.length} error(s)`)
      const info = `Last sync ${new Date().toLocaleTimeString()}: ${bits.join(', ') || 'up to date'}`
      setLastSyncInfo(info)
      if (result.errors.length) console.error('sync errors', result.errors)
      showToast(bits.length ? `Sync: ${bits.join(', ')}` : 'Sync: up to date')
    } catch (e) {
      showToast(`Sync failed: ${String(e)}`)
    } finally {
      setSyncing(false)
    }
  }, [showToast])

  // Sync once on load when a token exists.
  useEffect(() => {
    if (!unlocked) return
    if (loaded && loadConfig().token) void doSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, unlocked])

  // --- Keyboard ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === 'Escape') {
        setSearchOpen(false)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // --- Graph data ----------------------------------------------------------------
  const noteList = useMemo(() => [...notes.values()], [notes])
  const graph = useMemo(() => buildGraph(noteList), [noteList])

  const visible = useMemo(() => {
    let keep: Set<string> | null = null
    const needTagFilter = hiddenTags.size > 0 || !showGhosts
    if (needTagFilter) {
      keep = new Set(
        graph.nodes
          .filter((n) => (showGhosts || !n.ghost) && !(n.tag && hiddenTags.has(n.tag)))
          .map((n) => n.id),
      )
    }
    if (selected && focusDepth !== null) {
      const { keep: local } = localSubgraph(graph, selected, focusDepth)
      keep = keep ? new Set([...local].filter((id) => keep!.has(id))) : local
      keep.add(selected)
    }
    return keep
  }, [graph, hiddenTags, showGhosts, selected, focusDepth])

  const openNote = useCallback((title: string) => {
    // Resolve case-insensitively to an existing note when possible.
    const match = [...notesRef.current.keys()].find(
      (t) => normalizeTitle(t) === normalizeTitle(title),
    )
    setSelected(match ?? title)
    setSearchOpen(false)
    window.setTimeout(() => graphRef.current?.focusNode(match ?? title), 50)
  }, [])

  // --- Test notes -----------------------------------------------------------------
  const generateTestNotes = useCallback((count: number) => {
    const created: StoredNote[] = []
    const clusters = 8
    for (let i = 0; i < count; i++) {
      const cluster = i % clusters
      const links: string[] = [`Test Hub ${cluster}`]
      const linkCount = 1 + Math.floor(Math.random() * 3)
      for (let j = 0; j < linkCount && i > 2; j++) {
        const prev = Math.floor(Math.random() * i)
        links.push(`Test Note ${prev}`)
      }
      created.push({
        title: `Test Note ${i}`,
        content: `---\ntags: [test-${cluster}]\n---\n# Test Note ${i}\n\nSynthetic note. ${links.map((l) => `[[${l}]]`).join(' ')}\n`,
        dirty: false,
        test: true,
        updatedAt: Date.now(),
      })
    }
    for (let c = 0; c < clusters; c++) {
      created.push({
        title: `Test Hub ${c}`,
        content: `---\ntags: [test-${c}]\n---\n# Test Hub ${c}\n`,
        dirty: false,
        test: true,
        updatedAt: Date.now(),
      })
    }
    setNotes((prev) => {
      const next = new Map(prev)
      for (const n of created) {
        next.set(n.title, n)
        void putNote(n)
      }
      return next
    })
    setSettingsOpen(false)
    showToast(`Generated ${count} test notes.`)
  }, [showToast])

  const clearTestNotes = useCallback(() => {
    setNotes((prev) => {
      const next = new Map(prev)
      for (const [title, n] of prev) {
        if (n.test) {
          next.delete(title)
          void deleteNoteFromDB(title)
        }
      }
      return next
    })
    showToast('Test notes cleared.')
  }, [showToast])

  // --- Export / import ---------------------------------------------------------------
  const exportZip = useCallback(() => {
    const files: Record<string, Uint8Array> = {}
    for (const n of notesRef.current.values()) {
      if (!n.test) files[`notes/${n.title}.md`] = strToU8(n.content)
    }
    const zipped = zipSync(files)
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `closet-wiki-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  const importZip = useCallback(async (file: File) => {
    const data = unzipSync(new Uint8Array(await file.arrayBuffer()))
    let n = 0
    for (const [path, bytes] of Object.entries(data)) {
      if (!path.toLowerCase().endsWith('.md')) continue
      const title = path.split('/').pop()!.replace(/\.md$/i, '')
      upsertNote(title, strFromU8(bytes))
      n++
    }
    showToast(`Imported ${n} notes.`)
    scheduleAutoSync()
  }, [upsertNote, showToast, scheduleAutoSync])

  // --- Render ------------------------------------------------------------------------
  const selectedNote = selected ? notes.get(selected) : undefined
  const dirtyCount = useMemo(() => noteList.filter((n) => n.dirty && !n.test).length, [noteList])
  const topTags = useMemo(
    () => [...graph.tags.entries()].filter(([t]) => !t.startsWith('test-')).sort((a, b) => b[1] - a[1]).slice(0, 12),
    [graph],
  )

  const unlock = useCallback(async (password: string, code: string) => {
    const cfg = loadVaultConfig()
    if (cfg) {
      const { key, totpSecret } = await unlockVault(cfg, password)
      if (!(await verifyTotp(totpSecret, code))) throw new Error('Invalid authenticator code.')
      vaultKeyRef.current = key
      setVaultConfig(cfg)
      setUnlocked(true)
      return
    }
    // Legacy two-step enrollment (pre-vault): unlocking reveals the TOTP
    // secret, so upgrade in place to an encrypted vault with the same
    // password and authenticator — no re-enrollment needed.
    const legacy = loadTwoStepConfig()
    if (legacy) {
      // Guard: if another device already published an encrypted vault, adopt
      // it instead of creating a conflicting one (which would overwrite the
      // other device's vault and orphan its notes). Closes the race where the
      // mount-time adoption fetch hasn't landed yet.
      const syncCfg = loadConfig()
      if (syncCfg.token) {
        try {
          const remote = await fetchVaultRemote(syncCfg)
          if (remote && !isTombstone(remote.remote)) {
            saveVaultConfig(remote.remote)
            saveTwoStepConfig(null)
            setVaultConfig(remote.remote)
            throw new Error(
              'This wiki is already protected from another device — unlock with THAT device’s vault password.',
            )
          }
        } catch (e) {
          // A thrown adoption message should surface to the gate; network
          // errors fall through to the in-place upgrade below.
          if (e instanceof Error && e.message.startsWith('This wiki is already protected')) throw e
        }
      }
      const totpSecret = await unlockTwoStep(legacy, password, code)
      const { config, key } = await createVault(password, totpSecret)
      saveVaultConfig(config)
      saveTwoStepConfig(null)
      vaultKeyRef.current = key
      setVaultConfig(config)
      setUnlocked(true)
      showToast('Security upgraded: your notes are now end-to-end encrypted.')
      return
    }
    setUnlocked(true)
  }, [showToast])

  // Escape hatch for a forgotten vault password. Removes THIS browser's lock so
  // a device whose encryption never finished/synced isn't stranded. It cannot
  // decrypt notes already encrypted on GitHub — those are unrecoverable without
  // the password by design — so it reports whether such a remote vault exists.
  const resetVault = useCallback(async (): Promise<{ hadRemoteVault: boolean }> => {
    const cfg = loadConfig()
    let hadRemoteVault = false
    if (cfg.token) {
      try {
        const remote = await fetchVaultRemote(cfg)
        hadRemoteVault = !!remote && !isTombstone(remote.remote)
      } catch {
        // Offline / no access: proceed with the local reset anyway.
      }
    }
    saveVaultConfig(null)
    saveTwoStepConfig(null)
    vaultKeyRef.current = null
    setVaultConfig(null)
    setUnlocked(true)
    return { hadRemoteVault }
  }, [])

  const enableTwoStep = useCallback(async (password: string, secret: string, code: string) => {
    if (!(await verifyTotp(secret, code))) throw new Error('That code doesn’t match. Check your authenticator and try again.')
    const { config, key } = await createVault(password, secret)
    saveVaultConfig(config)
    vaultKeyRef.current = key
    setVaultConfig(config)
    setUnlocked(true)
    showToast('Vault enabled: notes are end-to-end encrypted and locked behind two-step.')
    // Best-effort: publish the (encrypted) settings so other devices adopt it.
    const cfg = loadConfig()
    if (cfg.token) {
      try {
        const remote = await fetchVaultRemote(cfg)
        await pushVaultRemote(cfg, config, remote?.sha)
      } catch (e) {
        showToast(`Vault enabled locally, but publishing to GitHub failed: ${String(e)}`)
      }
    }
  }, [showToast])

  const disableTwoStep = useCallback(() => {
    void (async () => {
      const cfg = loadConfig()
      if (cfg.token && loadVaultConfig()) {
        try {
          const remote = await fetchVaultRemote(cfg)
          await pushVaultRemote(cfg, { v: 1, disabled: true, updatedAt: Date.now() }, remote?.sha)
        } catch {
          showToast('Could not update GitHub; other devices may stay locked.')
        }
      }
      saveVaultConfig(null)
      saveTwoStepConfig(null)
      vaultKeyRef.current = null
      setVaultConfig(null)
      setUnlocked(true)
      showToast('Vault disabled. Notes stay on this device; sync is paused until you re-enable it.')
    })()
  }, [showToast])

  const lockNow = useCallback(() => {
    if (!vaultConfig) return
    if (syncTimer.current) clearTimeout(syncTimer.current)
    vaultKeyRef.current = null
    setLoaded(false)
    setNotes(new Map())
    setSelected(null)
    setSearchOpen(false)
    setSettingsOpen(false)
    setUnlocked(false)
  }, [vaultConfig])

  if (!unlocked) return <SecurityGate onUnlock={unlock} onReset={resetVault} />

  if (!loaded) return <div className="loading">Loading your second brain…</div>

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand" onClick={() => graphRef.current?.zoomToFit()}>🧠 Closet</span>
        <span className="stats">{noteList.length} notes · {graph.links.length} links</span>
        <div className="spacer" />
        <button className="btn subtle" onClick={() => setSearchOpen(true)}>🔍 <kbd>⌘K</kbd></button>
        <button className="btn subtle" onClick={() => createNoteViaPrompt(createNote)}>＋ New</button>
        <button className="btn subtle" disabled={syncing} onClick={() => void doSync()}>
          {syncing ? '⟳ Syncing…' : dirtyCount > 0 ? `⇅ Sync (${dirtyCount})` : '⇅ Sync'}
        </button>
        <button className="btn subtle" onClick={() => setSettingsOpen(true)}>⚙</button>
      </header>

      <GraphView
        ref={graphRef}
        graph={graph}
        visible={visible}
        physics={physics}
        selectedId={selected}
        onNodeClick={(id) => openNote(id)}
        onBackgroundClick={() => setSelected(null)}
      />

      <div className={`controls ${controlsOpen ? 'open' : ''}`}>
        <button className="btn subtle controls-toggle" onClick={() => setControlsOpen((v) => !v)}>
          {controlsOpen ? '✕ Controls' : '⚙ Physics & filters'}
        </button>
        {controlsOpen && (
          <div className="controls-body">
            <Slider label="Repel" min={0} max={300} value={physics.repel} onChange={(v) => setPhysics((p) => ({ ...p, repel: v }))} />
            <Slider label="Link distance" min={10} max={120} value={physics.linkDistance} onChange={(v) => setPhysics((p) => ({ ...p, linkDistance: v }))} />
            <Slider label="Link strength" min={0} max={1} step={0.05} value={physics.linkStrength} onChange={(v) => setPhysics((p) => ({ ...p, linkStrength: v }))} />
            <Slider label="Center pull" min={0} max={0.3} step={0.01} value={physics.centerStrength} onChange={(v) => setPhysics((p) => ({ ...p, centerStrength: v }))} />
            <Slider label="Label size" min={6} max={18} value={physics.labelSize} onChange={(v) => setPhysics((p) => ({ ...p, labelSize: v }))} />
            <label className="check">
              <input type="checkbox" checked={showGhosts} onChange={(e) => setShowGhosts(e.target.checked)} />
              Show ghost notes
            </label>
            {topTags.length > 0 && (
              <div className="section-legend">
                <h4>Sections</h4>
                <div className="tag-filters">
                  {topTags.map(([tag, count]) => (
                    <button
                      key={tag}
                      className={`tag-chip ${hiddenTags.has(tag) ? 'off' : ''}`}
                      style={{ borderColor: tagColor(tag) }}
                      title={hiddenTags.has(tag) ? 'Show this section' : 'Hide this section'}
                      onClick={() =>
                        setHiddenSections((prev) => {
                          const next = new Set(prev)
                          if (next.has(tag)) next.delete(tag)
                          else next.add(tag)
                          return next
                        })
                      }
                    >
                      <span className="dot" style={{ background: tagColor(tag) }} />
                      {tag} <span className="count">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button className="btn subtle" onClick={() => graphRef.current?.zoomToFit()}>Fit view</button>
          </div>
        )}
      </div>

      {selected && (
        <NotePanel
          title={selected}
          content={selectedNote?.content ?? ''}
          exists={!!selectedNote}
          graph={graph}
          focusDepth={focusDepth}
          dirty={selectedNote?.dirty ?? false}
          noteTitles={noteList.filter((n) => !n.test).map((n) => n.title).sort()}
          sections={topTags.map(([t]) => t)}
          onChange={(c) => changeNote(selected, c)}
          onCreate={() => createNote(selected)}
          onCreateBackground={createNoteBackground}
          onDelete={() => deleteNote(selected)}
          onClose={() => { setSelected(null); setFocusDepth(null) }}
          onOpenNote={openNote}
          onToggleFocus={() => setFocusDepth((d) => (d === null ? 1 : d === 1 ? 2 : null))}
        />
      )}

      {searchOpen && (
        <SearchModal
          notes={noteList.filter((n) => !n.test)}
          onOpen={openNote}
          onCreate={createNote}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          config={config}
          syncing={syncing}
          lastSyncInfo={lastSyncInfo}
          twoStepConfig={vaultConfig}
          onSave={(cfg) => {
            setConfig(cfg)
            localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
            showToast('Settings saved.')
          }}
          onEnableTwoStep={enableTwoStep}
          onDisableTwoStep={disableTwoStep}
          onLockNow={lockNow}
          onSyncNow={() => void doSync()}
          onGenerateTestNotes={generateTestNotes}
          onClearTestNotes={clearTestNotes}
          onExport={exportZip}
          onImport={(f) => void importZip(f)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function createNoteViaPrompt(create: (title: string) => void) {
  const title = prompt('New note title:')
  if (title) create(title)
}

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
