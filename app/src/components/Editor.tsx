import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyInsert,
  detectTrigger,
  filterCommands,
  setSection,
  SlashCommand,
  Trigger,
} from '../lib/slash'

interface MenuItem {
  key: string
  label: string
  hint?: string
  isCreate?: boolean
}

interface Props {
  value: string
  noteTitles: string[]
  sections: string[]
  onChange: (text: string) => void
  onCreateNote: (title: string) => void
}

/** Measure the caret's pixel position inside a textarea via a hidden mirror. */
function caretXY(ta: HTMLTextAreaElement, caret: number): { top: number; left: number } {
  const mirror = document.createElement('div')
  const style = getComputedStyle(ta)
  for (const prop of [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'textIndent',
  ] as const) {
    mirror.style[prop] = style[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.width = `${ta.clientWidth}px`
  mirror.textContent = ta.value.slice(0, caret)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
  const pos = {
    top: marker.offsetTop - ta.scrollTop + lineHeight + 4,
    left: marker.offsetLeft,
  }
  document.body.removeChild(mirror)
  return pos
}

export default function Editor({ value, noteTitles, sections, onChange, onCreateNote }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [sectionMenu, setSectionMenu] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [sel, setSel] = useState(0)

  const refresh = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const t = detectTrigger(ta.value, ta.selectionStart)
    setTrigger(t)
    if (t) setPos(caretXY(ta, ta.selectionStart))
  }, [])

  useEffect(() => setSel(0), [trigger?.type, trigger?.query, sectionMenu])

  const items = useMemo<MenuItem[]>(() => {
    if (sectionMenu) {
      return [
        ...sections.map((s) => ({ key: s, label: s })),
        { key: '__new__', label: 'New section…', isCreate: true },
      ]
    }
    if (!trigger) return []
    if (trigger.type === 'command') {
      return filterCommands(trigger.query).map((c) => ({ key: c.id, label: c.label, hint: c.hint }))
    }
    const q = trigger.query.trim().toLowerCase()
    const hits: MenuItem[] = noteTitles
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, 8)
      .map((t) => ({ key: t, label: t }))
    if (q && !noteTitles.some((t) => t.toLowerCase() === q)) {
      hits.push({ key: `__create__`, label: `Create "${trigger.query.trim()}"`, isCreate: true })
    }
    return hits
  }, [trigger, sectionMenu, noteTitles, sections])

  const closeMenus = useCallback(() => {
    setTrigger(null)
    setSectionMenu(false)
  }, [])

  const applyToTextarea = useCallback(
    (text: string, caret: number) => {
      onChange(text)
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (ta) {
          ta.focus()
          ta.setSelectionRange(caret, caret)
        }
      })
    },
    [onChange],
  )

  const pick = useCallback(
    (item: MenuItem) => {
      const ta = taRef.current
      if (!ta) return
      const caret = ta.selectionStart

      if (sectionMenu) {
        const name = item.isCreate ? prompt('New section name:')?.trim().toLowerCase() : item.key
        setSectionMenu(false)
        if (name) onChange(setSection(value, name))
        return
      }
      if (!trigger) return

      if (trigger.type === 'link') {
        const isCreate = item.isCreate
        const title = isCreate ? trigger.query.trim() : item.key
        const r = applyInsert(value, trigger.start, caret, `[[${title}]] `)
        setTrigger(null)
        applyToTextarea(r.text, r.caret)
        if (isCreate) onCreateNote(title)
        return
      }

      // Command mode
      const cmd = filterCommands(trigger.query).find((c) => c.id === item.key) as SlashCommand
      setTrigger(null)
      if (!cmd) return
      if (cmd.action === 'link' || cmd.action === 'new-note') {
        const r = applyInsert(value, trigger.start, caret, '[[')
        applyToTextarea(r.text, r.caret)
        requestAnimationFrame(refresh)
      } else if (cmd.action === 'section') {
        const r = applyInsert(value, trigger.start, caret, '')
        applyToTextarea(r.text, r.caret)
        setSectionMenu(true)
      } else if (cmd.action === 'date') {
        const today = new Date().toISOString().slice(0, 10)
        const r = applyInsert(value, trigger.start, caret, today + ' ')
        applyToTextarea(r.text, r.caret)
      } else if (cmd.insert !== undefined) {
        const r = applyInsert(value, trigger.start, caret, cmd.insert, cmd.caretBack ?? 0)
        applyToTextarea(r.text, r.caret)
      }
    },
    [trigger, sectionMenu, value, onChange, onCreateNote, applyToTextarea, refresh],
  )

  const menuOpen = (trigger !== null && items.length > 0) || sectionMenu

  return (
    <div className="editor-wrap">
      <textarea
        ref={taRef}
        className="note-editor"
        value={value}
        autoFocus
        placeholder={'Write markdown… type / for commands, [[ to link notes'}
        onChange={(e) => {
          onChange(e.target.value)
          requestAnimationFrame(refresh)
        }}
        onKeyDown={(e) => {
          if (!menuOpen) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % items.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[sel]) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenus() }
        }}
        onClick={refresh}
        onBlur={() => window.setTimeout(closeMenus, 200)}
        onScroll={closeMenus}
      />
      {menuOpen && (
        <div
          className="slash-menu"
          style={{ top: Math.min(pos.top, (taRef.current?.clientHeight ?? 400) - 40), left: Math.min(pos.left, (taRef.current?.clientWidth ?? 300) - 230) }}
        >
          {sectionMenu && <div className="slash-title">Move to section</div>}
          <ul>
            {items.map((item, i) => (
              <li
                key={item.key}
                className={`${i === sel ? 'selected' : ''} ${item.isCreate ? 'create' : ''}`}
                onMouseEnter={() => setSel(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(item) }}
              >
                <span className="slash-label">{item.label}</span>
                {item.hint && <span className="slash-hint">{item.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
