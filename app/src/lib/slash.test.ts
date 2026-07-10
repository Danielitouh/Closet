import { describe, expect, it } from 'vitest'
import { applyInsert, detectTrigger, filterCommands, setSection } from './slash'

describe('detectTrigger — command mode', () => {
  it('detects / at start of text', () => {
    expect(detectTrigger('/', 1)).toEqual({ type: 'command', start: 0, query: '' })
  })

  it('detects / after whitespace with a query', () => {
    expect(detectTrigger('hello /hea', 10)).toEqual({ type: 'command', start: 6, query: 'hea' })
  })

  it('detects / at start of a new line', () => {
    expect(detectTrigger('line\n/li', 8)).toEqual({ type: 'command', start: 5, query: 'li' })
  })

  it('does not trigger mid-word (URLs)', () => {
    expect(detectTrigger('https://x', 9)).toBeNull()
  })

  it('does not trigger once a space ends the word', () => {
    expect(detectTrigger('/head done', 10)).toBeNull()
  })

  it('does not trigger when caret is before the slash', () => {
    expect(detectTrigger('/cmd', 0)).toBeNull()
  })
})

describe('detectTrigger — link mode', () => {
  it('detects [[ immediately', () => {
    expect(detectTrigger('see [[', 6)).toEqual({ type: 'link', start: 4, query: '' })
  })

  it('captures the partial title as query', () => {
    expect(detectTrigger('see [[Res', 9)).toEqual({ type: 'link', start: 4, query: 'Res' })
  })

  it('stops after the link is closed', () => {
    expect(detectTrigger('see [[Research]] and', 20)).toBeNull()
  })

  it('stops at a newline', () => {
    expect(detectTrigger('see [[Res\nnext', 14)).toBeNull()
  })

  it('link mode wins over an earlier slash', () => {
    expect(detectTrigger('a /cmd [[X', 10)).toEqual({ type: 'link', start: 7, query: 'X' })
  })

  it('spaces allowed inside link queries', () => {
    expect(detectTrigger('[[Reading Li', 12)).toEqual({ type: 'link', start: 0, query: 'Reading Li' })
  })
})

describe('applyInsert', () => {
  it('replaces the trigger with the insertion', () => {
    const r = applyInsert('a /he b', 2, 5, '# ')
    expect(r.text).toBe('a #  b')
    expect(r.caret).toBe(4)
  })

  it('supports caretBack for code fences', () => {
    const r = applyInsert('/code', 0, 5, '```\n\n```', 4)
    expect(r.text).toBe('```\n\n```')
    expect(r.caret).toBe(4)
  })

  it('completes a wikilink', () => {
    const r = applyInsert('see [[Res', 4, 9, '[[Research]] ')
    expect(r.text).toBe('see [[Research]] ')
    expect(r.caret).toBe(17)
  })
})

describe('filterCommands', () => {
  it('returns all commands for empty query', () => {
    expect(filterCommands('').length).toBeGreaterThan(8)
  })

  it('filters by prefix and label', () => {
    expect(filterCommands('h1').map((c) => c.id)).toContain('h1')
    expect(filterCommands('head').map((c) => c.id)).toEqual(['h1', 'h2', 'h3'])
    expect(filterCommands('zzz')).toEqual([])
  })
})

describe('setSection', () => {
  it('adds frontmatter when none exists', () => {
    expect(setSection('# T\nbody', 'ideas')).toBe('---\nsection: ideas\n---\n# T\nbody')
  })

  it('replaces an existing section', () => {
    expect(setSection('---\nsection: old\ntags: [x]\n---\nbody', 'research')).toBe(
      '---\nsection: research\ntags: [x]\n---\nbody',
    )
  })

  it('adds section to existing frontmatter without one', () => {
    expect(setSection('---\ntags: [x]\n---\nbody', 'journal')).toBe(
      '---\nsection: journal\ntags: [x]\n---\nbody',
    )
  })
})
