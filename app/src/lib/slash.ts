// Editor trigger detection for the slash-command menu and [[link]] picker.

export interface Trigger {
  type: 'command' | 'link'
  /** Index in the text where the trigger token starts ('/' or '[['). */
  start: number
  /** Text typed after the trigger, used to filter the menu. */
  query: string
}

/**
 * Detect an active trigger at the caret.
 * - '/' starts command mode when it begins a word (start of text/line or
 *   after whitespace) and the caret is still within the same word.
 * - '[[' starts link mode until it's closed with ']]' or broken by a newline.
 * Returns null when the caret isn't inside an active trigger.
 */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret)

  // Link mode: last unclosed '[[' before the caret, no newline in between.
  const open = before.lastIndexOf('[[')
  if (open !== -1) {
    const between = before.slice(open + 2)
    if (!between.includes(']]') && !between.includes('\n') && !between.includes('[[')) {
      return { type: 'link', start: open, query: between }
    }
  }

  // Command mode: '/word' with the slash at a word boundary.
  const slash = before.lastIndexOf('/')
  if (slash !== -1) {
    const between = before.slice(slash + 1)
    if (!/[\s/]/.test(between)) {
      const prev = slash === 0 ? '' : before[slash - 1]
      if (prev === '' || /\s/.test(prev)) {
        return { type: 'command', start: slash, query: between }
      }
    }
  }

  return null
}

/**
 * Replace [start, caret) with `insert`, optionally moving the caret back
 * `caretBack` characters from the end of the inserted text (for placing the
 * cursor inside inserted syntax like code fences).
 */
export function applyInsert(
  text: string,
  start: number,
  caret: number,
  insert: string,
  caretBack = 0,
): { text: string; caret: number } {
  const next = text.slice(0, start) + insert + text.slice(caret)
  return { text: next, caret: start + insert.length - caretBack }
}

export interface SlashCommand {
  id: string
  label: string
  hint: string
  /** Text to insert; '\n'-prefixed inserts ensure their own line. */
  insert?: string
  caretBack?: number
  /** Special behaviors handled by the editor. */
  action?: 'link' | 'new-note' | 'section' | 'date'
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'link', label: 'Link to note', hint: 'Connect this note to another', action: 'link' },
  { id: 'new', label: 'New linked note', hint: 'Create a note and link it here', action: 'new-note' },
  { id: 'section', label: 'Set section', hint: "Move this note to a section of the brain", action: 'section' },
  { id: 'date', label: 'Today', hint: 'Insert today’s date', action: 'date' },
  { id: 'h1', label: 'Heading 1', hint: 'Big section heading', insert: '# ' },
  { id: 'h2', label: 'Heading 2', hint: 'Medium heading', insert: '## ' },
  { id: 'h3', label: 'Heading 3', hint: 'Small heading', insert: '### ' },
  { id: 'bullet', label: 'Bullet list', hint: 'Plain list item', insert: '- ' },
  { id: 'todo', label: 'Task list', hint: 'Checkbox list item', insert: '- [ ] ' },
  { id: 'quote', label: 'Quote', hint: 'Block quote', insert: '> ' },
  { id: 'code', label: 'Code block', hint: 'Fenced code', insert: '```\n\n```', caretBack: 4 },
  { id: 'divider', label: 'Divider', hint: 'Horizontal rule', insert: '---\n' },
]

export function filterCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (c) =>
      c.id.startsWith(q) ||
      c.label.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q),
  )
}

/** Set (or add) the `section:` key in a note's frontmatter block. */
export function setSection(raw: string, section: string): string {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!fm) {
    return `---\nsection: ${section}\n---\n${raw}`
  }
  const block = fm[1]
  let newBlock: string
  if (/^section\s*:/im.test(block)) {
    newBlock = block.replace(/^section\s*:.*$/im, `section: ${section}`)
  } else {
    newBlock = `section: ${section}\n${block}`
  }
  return raw.replace(fm[0], `---\n${newBlock}\n---\n`)
}
