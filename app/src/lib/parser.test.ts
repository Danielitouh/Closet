import { describe, expect, it } from 'vitest'
import {
  extractInlineTags,
  extractLinks,
  filenameToTitle,
  parseNote,
  titleToFilename,
} from './parser'

describe('extractLinks', () => {
  it('finds simple wikilinks', () => {
    expect(extractLinks('a [[Foo]] b [[Bar]]')).toEqual([
      { target: 'Foo', alias: null },
      { target: 'Bar', alias: null },
    ])
  })

  it('supports aliases', () => {
    expect(extractLinks('see [[Real Note|the note]]')).toEqual([
      { target: 'Real Note', alias: 'the note' },
    ])
  })

  it('handles multiple links on one line and trims whitespace', () => {
    expect(extractLinks('[[ A ]][[B|b ]]')).toEqual([
      { target: 'A', alias: null },
      { target: 'B', alias: 'b' },
    ])
  })

  it('ignores empty and malformed links', () => {
    expect(extractLinks('[[]] [[|x]] [not a link] [[ok]]')).toEqual([
      { target: 'ok', alias: null },
    ])
  })

  it('handles unicode titles', () => {
    expect(extractLinks('[[小红书研究]]')).toEqual([{ target: '小红书研究', alias: null }])
  })

  it('ignores links inside inline code spans', () => {
    expect(extractLinks('use `[[Note Title]]` to link, e.g. [[Real]]')).toEqual([
      { target: 'Real', alias: null },
    ])
  })

  it('ignores links inside fenced code blocks', () => {
    expect(extractLinks('```\n[[Not A Link]]\n```\n[[Yes]]')).toEqual([
      { target: 'Yes', alias: null },
    ])
  })

  it('does not pair brackets across adjacent code spans', () => {
    expect(extractLinks('brackets: `[[` then `]]` done')).toEqual([])
  })
})

describe('extractInlineTags', () => {
  it('finds inline tags', () => {
    expect(extractInlineTags('hello #ai and #knowledge-mgmt')).toEqual(['ai', 'knowledge-mgmt'])
  })

  it('does not treat markdown headings as tags', () => {
    expect(extractInlineTags('# Heading\n## Another\ntext #real')).toEqual(['real'])
  })

  it('does not match mid-word or URL fragments', () => {
    expect(extractInlineTags('https://x.com/a#frag no#tag yes #tag')).toEqual(['tag'])
  })

  it('ignores tags inside code', () => {
    expect(extractInlineTags('`#nope` and ```\n#also-no\n``` but #yes')).toEqual(['yes'])
  })
})

describe('parseNote', () => {
  it('parses frontmatter list tags and strips the block', () => {
    const raw = '---\ntags:\n  - AI\n  - research\n---\n# Body\ntext'
    const p = parseNote(raw)
    expect(p.tags).toEqual(['ai', 'research'])
    expect(p.body.startsWith('# Body')).toBe(true)
  })

  it('parses inline-array frontmatter tags', () => {
    const p = parseNote('---\ntags: [one, "two"]\n---\nx')
    expect(p.tags).toEqual(['one', 'two'])
  })

  it('parses comma/scalar frontmatter tags', () => {
    expect(parseNote('---\ntags: solo\n---\nx').tags).toEqual(['solo'])
    expect(parseNote('---\ntags: a, b\n---\nx').tags).toEqual(['a', 'b'])
  })

  it('merges and dedupes frontmatter + inline tags case-insensitively', () => {
    const p = parseNote('---\ntags: [AI]\n---\nabout #ai and #ML')
    expect(p.tags).toEqual(['ai', 'ml'])
  })

  it('handles notes without frontmatter', () => {
    const p = parseNote('just text with [[Link]]')
    expect(p.tags).toEqual([])
    expect(p.links).toEqual([{ target: 'Link', alias: null }])
    expect(p.body).toBe('just text with [[Link]]')
  })

  it('does not treat a mid-document --- rule as frontmatter', () => {
    const p = parseNote('intro\n---\ntags: nope\n---\nrest')
    expect(p.tags).toEqual([])
  })

  it('handles CRLF line endings', () => {
    const p = parseNote('---\r\ntags: [win]\r\n---\r\nbody [[X]]')
    expect(p.tags).toEqual(['win'])
    expect(p.links).toEqual([{ target: 'X', alias: null }])
  })
})

describe('sections', () => {
  it('reads section from frontmatter', () => {
    const p = parseNote('---\nsection: Research\ntags: [ai]\n---\nx')
    expect(p.section).toBe('research')
  })

  it('falls back to the first tag when no section is set', () => {
    expect(parseNote('---\ntags: [guide, extra]\n---\nx').section).toBe('guide')
  })

  it('is null with neither section nor tags', () => {
    expect(parseNote('plain text').section).toBeNull()
  })

  it('handles quoted section values', () => {
    expect(parseNote('---\nsection: "My Projects"\n---\nx').section).toBe('my projects')
  })
})

describe('filenames', () => {
  it('round-trips simple titles', () => {
    expect(filenameToTitle(titleToFilename('My Note'))).toBe('My Note')
  })

  it('sanitizes forbidden characters', () => {
    expect(titleToFilename('a/b:c?d')).toBe('a-b-c-d.md')
  })
})
