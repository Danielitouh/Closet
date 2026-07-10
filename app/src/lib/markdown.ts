import { marked } from 'marked'
import { maskCode, parseNote } from './parser'

marked.setOptions({ gfm: true, breaks: true })

const WIKILINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g

/**
 * Render note markdown to HTML with [[wikilinks]] converted to clickable
 * elements. Existing targets get .wiki-link, unresolved get .wiki-link.ghost;
 * both carry data-wiki="<target>" for the click handler. Links inside code
 * spans/blocks are left as literal text (matching the graph parser).
 */
export function renderNoteHtml(raw: string, exists: (title: string) => boolean): string {
  const { body } = parseNote(raw)
  // Find link positions on the code-masked text (offsets match the original),
  // then splice replacements into the original so code content is untouched.
  const masked = maskCode(body)
  let out = ''
  let cursor = 0
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const target = m[1].trim()
    if (!target) continue
    const text = (m[2] ?? target).trim()
    const ghost = exists(target) ? '' : ' ghost'
    const safeTarget = target.replace(/"/g, '&quot;')
    out += body.slice(cursor, m.index!)
    out += `<a class="wiki-link${ghost}" data-wiki="${safeTarget}" href="#">${text}</a>`
    cursor = m.index! + m[0].length
  }
  out += body.slice(cursor)
  return marked.parse(out) as string
}
