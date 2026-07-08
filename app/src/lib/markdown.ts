import { marked } from 'marked'
import { parseNote } from './parser'

marked.setOptions({ gfm: true, breaks: true })

/**
 * Render note markdown to HTML with [[wikilinks]] converted to clickable
 * elements. Existing targets get .wiki-link, unresolved get .wiki-link.ghost;
 * both carry data-wiki="<target>" for the click handler.
 */
export function renderNoteHtml(raw: string, exists: (title: string) => boolean): string {
  const { body } = parseNote(raw)
  const withLinks = body.replace(
    /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g,
    (_m, target: string, alias?: string) => {
      const t = target.trim()
      const text = (alias ?? t).trim()
      const ghost = exists(t) ? '' : ' ghost'
      const safeTarget = t.replace(/"/g, '&quot;')
      return `<a class="wiki-link${ghost}" data-wiki="${safeTarget}" href="#">${text}</a>`
    },
  )
  return marked.parse(withLinks) as string
}
