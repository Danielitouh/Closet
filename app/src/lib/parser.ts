// Markdown note parsing: YAML-ish frontmatter, [[wikilinks]], #tags.

export interface WikiLink {
  target: string
  alias: string | null
}

export interface ParsedNote {
  /** Content with the frontmatter block removed. */
  body: string
  /** Tags from frontmatter `tags:` plus inline #tags, deduped, lowercase. */
  tags: string[]
  /** All wikilinks in order of appearance (may contain duplicates). */
  links: WikiLink[]
  /** Brain section from frontmatter `section:`, falling back to the first tag. */
  section: string | null
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Minimal frontmatter reader: only cares about `tags`, tolerates the rest. */
function parseFrontmatterTags(block: string): string[] {
  const tags: string[] = []
  const lines = block.split(/\r?\n/)
  let inTagsList = false
  for (const line of lines) {
    if (inTagsList) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/)
      if (item) {
        tags.push(item[1])
        continue
      }
      inTagsList = false
    }
    const m = line.match(/^tags\s*:\s*(.*)$/i)
    if (!m) continue
    const rest = m[1].trim()
    if (rest === '') {
      inTagsList = true
    } else if (rest.startsWith('[')) {
      // tags: [a, b, c]
      for (const t of rest.replace(/^\[|\]$/g, '').split(',')) {
        const v = t.trim().replace(/^["']|["']$/g, '')
        if (v) tags.push(v)
      }
    } else {
      // tags: a, b  (or a single tag)
      for (const t of rest.split(',')) {
        const v = t.trim().replace(/^["']|["']$/g, '')
        if (v) tags.push(v)
      }
    }
  }
  return tags
}

const WIKILINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g

/**
 * Blank out fenced code blocks (```…```) and inline code spans (`…`) so that
 * syntax examples in notes don't register as real links or tags. Replacement
 * preserves string length/offsets.
 */
export function maskCode(body: string): string {
  return body
    .replace(/```[\s\S]*?(```|$)/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

export function extractLinks(body: string): WikiLink[] {
  const links: WikiLink[] = []
  for (const m of maskCode(body).matchAll(WIKILINK_RE)) {
    const target = m[1].trim()
    if (!target) continue
    links.push({ target, alias: m[2] !== undefined ? m[2].trim() : null })
  }
  return links
}

// Inline tags: #word (letters/digits/dash/underscore/slash), not markdown
// headings (# followed by space) and not fragments inside URLs (preceded by
// a non-space char other than start of line).
const INLINE_TAG_RE = /(^|\s)#([A-Za-z][\w/-]*)/g

export function extractInlineTags(body: string): string[] {
  const tags: string[] = []
  for (const m of maskCode(body).matchAll(INLINE_TAG_RE)) {
    tags.push(m[2])
  }
  return tags
}

function parseFrontmatterSection(block: string): string | null {
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^section\s*:\s*(.+?)\s*$/i)
    if (m) {
      const v = m[1].replace(/^["']|["']$/g, '').trim()
      if (v) return v.toLowerCase()
    }
  }
  return null
}

export function parseNote(raw: string): ParsedNote {
  let body = raw
  let fmTags: string[] = []
  let section: string | null = null
  const fm = raw.match(FRONTMATTER_RE)
  if (fm) {
    fmTags = parseFrontmatterTags(fm[1])
    section = parseFrontmatterSection(fm[1])
    body = raw.slice(fm[0].length)
  }
  const inline = extractInlineTags(body)
  const tags = [...new Set([...fmTags, ...inline].map((t) => t.toLowerCase().replace(/^#/, '')))]
  return { body, tags, links: extractLinks(body), section: section ?? tags[0] ?? null }
}

/** Normalize a note title for link resolution (case-insensitive match). */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

/** Make a title safe to use as a filename in /notes. */
export function titleToFilename(title: string): string {
  return title.trim().replace(/[\\/:*?"<>|#^[\]]/g, '-') + '.md'
}

export function filenameToTitle(name: string): string {
  return name.replace(/\.md$/i, '')
}
