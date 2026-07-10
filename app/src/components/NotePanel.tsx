import { useEffect, useMemo, useRef, useState } from 'react'
import type { WikiGraph } from '../lib/graphData'
import { renderNoteHtml } from '../lib/markdown'
import Editor from './Editor'

interface Props {
  title: string
  content: string
  exists: boolean
  graph: WikiGraph
  focusDepth: number | null
  dirty: boolean
  noteTitles: string[]
  sections: string[]
  onChange: (content: string) => void
  onCreate: () => void
  onCreateBackground: (title: string) => void
  onDelete: () => void
  onClose: () => void
  onOpenNote: (title: string) => void
  onToggleFocus: () => void
}

export default function NotePanel({
  title,
  content,
  exists,
  graph,
  focusDepth,
  dirty,
  noteTitles,
  sections,
  onChange,
  onCreate,
  onCreateBackground,
  onDelete,
  onClose,
  onOpenNote,
  onToggleFocus,
}: Props) {
  const [editing, setEditing] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => setEditing(false), [title])

  const html = useMemo(
    () => renderNoteHtml(content, (t) => graph.nodes.some((n) => !n.ghost && n.id.toLowerCase() === t.trim().toLowerCase())),
    [content, graph],
  )

  const backlinks = useMemo(() => [...(graph.backlinks.get(title) ?? [])].sort(), [graph, title])

  // Delegate clicks on rendered wikilinks.
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const handler = (e: Event) => {
      const a = (e.target as HTMLElement).closest('a.wiki-link') as HTMLElement | null
      if (a) {
        e.preventDefault()
        onOpenNote(a.dataset.wiki!)
      }
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  })

  if (!exists) {
    return (
      <aside className="note-panel">
        <header className="note-header">
          <h2>{title}</h2>
          <div className="note-actions">
            <button className="btn subtle" onClick={onClose}>✕</button>
          </div>
        </header>
        <div className="note-body ghost-note">
          <p>This note doesn't exist yet. It's referenced by:</p>
          <ul>
            {backlinks.map((b) => (
              <li key={b}>
                <a className="wiki-link" href="#" onClick={(e) => { e.preventDefault(); onOpenNote(b) }}>{b}</a>
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={onCreate}>Create "{title}"</button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="note-panel">
      <header className="note-header">
        <h2 title={title}>{title}</h2>
        <div className="note-actions">
          <span className={`sync-dot ${dirty ? 'dirty' : 'clean'}`} title={dirty ? 'Unsynced changes' : 'Synced'} />
          <button
            className={`btn subtle ${focusDepth !== null ? 'active' : ''}`}
            title="Local graph: show only this note's neighborhood"
            onClick={onToggleFocus}
          >
            ◎ {focusDepth !== null ? `Focus ${focusDepth}` : 'Focus'}
          </button>
          <button className="btn subtle" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Preview' : 'Edit'}
          </button>
          <button
            className="btn subtle danger"
            onClick={() => {
              if (confirm(`Delete "${title}"?`)) onDelete()
            }}
          >
            🗑
          </button>
          <button className="btn subtle" onClick={onClose}>✕</button>
        </div>
      </header>
      {editing ? (
        <Editor
          value={content}
          noteTitles={noteTitles.filter((t) => t !== title)}
          sections={sections}
          onChange={onChange}
          onCreateNote={onCreateBackground}
        />
      ) : (
        <div ref={previewRef} className="note-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {backlinks.length > 0 && (
        <footer className="backlinks">
          <h3>Linked from</h3>
          <ul>
            {backlinks.map((b) => (
              <li key={b}>
                <a className="wiki-link" href="#" onClick={(e) => { e.preventDefault(); onOpenNote(b) }}>{b}</a>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </aside>
  )
}
