import { useEffect, useMemo, useRef, useState } from 'react'
import type { StoredNote } from '../lib/store'

interface Props {
  notes: StoredNote[]
  onOpen: (title: string) => void
  onCreate: (title: string) => void
  onClose: () => void
}

interface Hit {
  title: string
  snippet: string | null
  create?: boolean
}

export default function SearchModal({ notes, onOpen, onCreate, onClose }: Props) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase()
    if (!query) {
      return notes
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12)
        .map((n) => ({ title: n.title, snippet: null }))
    }
    const titleHits: Hit[] = []
    const bodyHits: Hit[] = []
    for (const n of notes) {
      if (n.title.toLowerCase().includes(query)) {
        titleHits.push({ title: n.title, snippet: null })
      } else {
        const idx = n.content.toLowerCase().indexOf(query)
        if (idx >= 0) {
          const start = Math.max(0, idx - 34)
          const snippet =
            (start > 0 ? '…' : '') +
            n.content.slice(start, idx + query.length + 40).replace(/\n/g, ' ') +
            '…'
          bodyHits.push({ title: n.title, snippet })
        }
      }
    }
    const all = [...titleHits, ...bodyHits].slice(0, 15)
    const exact = notes.some((n) => n.title.toLowerCase() === query)
    if (!exact && q.trim()) all.push({ title: q.trim(), snippet: null, create: true })
    return all
  }, [q, notes])

  useEffect(() => setSel(0), [q])

  const choose = (hit: Hit) => (hit.create ? onCreate(hit.title) : onOpen(hit.title))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          placeholder="Search notes… (Enter to open, Esc to close)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter' && hits[sel]) choose(hits[sel])
            else if (e.key === 'Escape') onClose()
          }}
        />
        <ul className="search-results">
          {hits.map((h, i) => (
            <li
              key={(h.create ? '+' : '') + h.title}
              className={i === sel ? 'selected' : ''}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(h)}
            >
              {h.create ? (
                <span className="create-row">＋ Create "{h.title}"</span>
              ) : (
                <>
                  <span className="hit-title">{h.title}</span>
                  {h.snippet && <span className="hit-snippet">{h.snippet}</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
