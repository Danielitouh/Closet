import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GraphView, { DEFAULT_PHYSICS, GraphViewHandle, PhysicsSettings, tagColor } from './components/GraphView'
import NotePanel from './components/NotePanel'
import SearchModal from './components/SearchModal'
import SettingsModal from './components/SettingsModal'
import { buildGraph, localSubgraph } from './lib/graphData'
import { syncAll, SyncConfig } from './lib/github'
import { normalizeTitle } from './lib/parser'
import {
  deleteNoteFromDB,
  getAllNotes,
  getMeta,
  getSeedNotes,
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
  useEffect(() => {
    ;(async () => {
      let stored = await getAllNotes()
      if (stored.length === 0) {
        const seeds = getSeedNotes()
        stored = seeds.map((s) => ({
          title: s.title,
          content: s.content,
          dirty: false,
          updatedAt: Date.now(),
        }))
        await Promise.all(stored.map(putNote))
      }
      pendingDeletes.current = (await getMeta<string[]>('pendingDeletes')) ?? []
      setNotes(new Map(stored.map((n) => [n.title, n])))
      setLoaded(true)
    })()
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
    setSyncing(true)
    try {
      const result = await syncAll(cfg, [...notesRef.current.values()], pendingDeletes.current, {
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
    if (loaded && loadConfig().token) void doSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

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
          onChange={(c) => changeNote(selected, c)}
          onCreate={() => createNote(selected)}
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
          onSave={(cfg) => {
            setConfig(cfg)
            localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
            showToast('Settings saved.')
          }}
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
