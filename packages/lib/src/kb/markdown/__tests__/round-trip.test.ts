// packages/lib/src/kb/markdown/__tests__/round-trip.test.ts

import { describe, expect, it } from 'vitest'
import { blocksToMd } from '../blocks-to-md'
import { mdToBlocks, parseFrontmatter } from '../md-to-blocks'
import type { DocJSON } from '../types'

const mdToDoc = (md: string): DocJSON => ({ type: 'doc', content: mdToBlocks(md) })

function block(
  blockType: string,
  attrs: Record<string, unknown> = {},
  content: unknown[] = []
): unknown {
  return { type: 'block', attrs: { blockType, ...attrs }, content }
}

const text = (s: string, marks?: unknown[]) =>
  marks ? { type: 'text', text: s, marks } : { type: 'text', text: s }

describe('mdToBlocks — basic blocks', () => {
  it('parses headings (clamps to 3)', () => {
    const doc = mdToDoc('# H1\n\n## H2\n\n### H3\n\n#### H4')
    expect(doc.content.map((b) => b.attrs.blockType)).toEqual([
      'heading',
      'heading',
      'heading',
      'heading',
    ])
    expect(doc.content.map((b) => b.attrs.level)).toEqual([1, 2, 3, 3])
  })

  it('parses paragraphs as text blocks', () => {
    const doc = mdToDoc('Hello world.\n\nSecond para.')
    expect(doc.content).toHaveLength(2)
    expect(doc.content[0]).toMatchObject({ attrs: { blockType: 'text' } })
    expect(doc.content[1]).toMatchObject({ attrs: { blockType: 'text' } })
  })

  it('parses bullet, numbered, and task lists', () => {
    const md = '- one\n- two\n\n1. first\n2. second\n\n- [ ] open\n- [x] done'
    const doc = mdToDoc(md)
    const types = doc.content.map((b) => b.attrs.blockType)
    expect(types).toEqual([
      'bulletListItem',
      'bulletListItem',
      'numberedListItem',
      'numberedListItem',
      'todoListItem',
      'todoListItem',
    ])
    expect(doc.content[4]?.attrs.checked).toBe(false)
    expect(doc.content[5]?.attrs.checked).toBe(true)
  })

  it('parses nested lists with level attribute', () => {
    const md = '- one\n  - nested\n  - also nested\n- two'
    const doc = mdToDoc(md)
    expect(doc.content.map((b) => b.attrs.level)).toEqual([1, 2, 2, 1])
  })

  it('parses code fences with language', () => {
    const md = '```ts\nconst x = 1\n```'
    const doc = mdToDoc(md)
    expect(doc.content[0]?.attrs.blockType).toBe('codeBlock')
    expect(doc.content[0]?.attrs.codeLanguage).toBe('ts')
    expect(doc.content[0]?.content?.[0]).toEqual({ type: 'text', text: 'const x = 1' })
  })

  it('parses blockquotes and dividers', () => {
    const doc = mdToDoc('> quoted\n\n---\n\ntrailing')
    expect(doc.content.map((b) => b.attrs.blockType)).toEqual(['quote', 'divider', 'text'])
  })
})

describe('mdToBlocks — directives', () => {
  it('parses callout container directives', () => {
    const doc = mdToDoc(':::tip\nBe kind.\n:::')
    expect(doc.content[0]?.attrs.blockType).toBe('callout')
    expect(doc.content[0]?.attrs.calloutVariant).toBe('tip')
  })

  it('aliases note → info, warning → warn, danger → error', () => {
    const doc = mdToDoc(':::note\nA\n:::\n\n:::warning\nB\n:::\n\n:::danger\nC\n:::')
    expect(doc.content.map((b) => b.attrs.calloutVariant)).toEqual(['info', 'warn', 'error'])
  })

  it('parses embed leaf directives', () => {
    const doc = mdToDoc('::embed{url="https://www.youtube.com/watch?v=abcdefg" provider="youtube"}')
    expect(doc.content[0]).toMatchObject({
      attrs: { blockType: 'embed', embedUrl: 'https://www.youtube.com/watch?v=abcdefg' },
    })
  })

  it('promotes a bare YouTube URL line to an embed', () => {
    const doc = mdToDoc('https://www.youtube.com/watch?v=abcdefg')
    expect(doc.content[0]?.attrs.blockType).toBe('embed')
    expect(doc.content[0]?.attrs.embedProvider).toBe('youtube')
  })
})

describe('mdToBlocks — inline marks', () => {
  it('parses bold, italic, strike, code', () => {
    const doc = mdToDoc('**bold** *italic* ~~strike~~ `code`')
    const inline = doc.content[0]?.content ?? []
    const marksOf = (i: number) => (inline[i] as { marks?: { type: string }[] }).marks?.[0]?.type
    expect(marksOf(0)).toBe('bold')
    expect(marksOf(2)).toBe('italic')
    expect(marksOf(4)).toBe('strike')
    expect(marksOf(6)).toBe('code')
  })

  it('parses links with href attr', () => {
    const doc = mdToDoc('[click](https://example.com)')
    const inline = doc.content[0]?.content?.[0] as {
      type: string
      marks?: { type: string; attrs?: Record<string, unknown> }[]
    }
    expect(inline.marks?.[0]?.type).toBe('link')
    expect(inline.marks?.[0]?.attrs?.href).toBe('https://example.com')
  })

  it('parses <u> as underline mark', () => {
    const doc = mdToDoc('plain <u>emphasized</u>.')
    const inline = doc.content[0]?.content ?? []
    const u = inline.find((n) =>
      (n as { marks?: { type: string }[] }).marks?.some((m) => m.type === 'underline')
    )
    expect(u).toBeTruthy()
  })

  it('extracts {{placeholder}} syntax', () => {
    const doc = mdToDoc('Hi {{first_name}}, welcome.')
    const inline = doc.content[0]?.content ?? []
    expect(inline[1]).toEqual({ type: 'placeholder', attrs: { id: 'first_name' } })
  })

  it('emits code mark exclusively (no bold+code combos that the schema rejects)', () => {
    // ProseMirror's `code` mark excludes all others. If the converter combined
    // it with bold/italic, the editor would throw "Invalid collection of marks".
    const doc = mdToDoc('**before `inside` after**')
    const inline = doc.content[0]?.content ?? []
    for (const node of inline) {
      const marks = (node as { marks?: { type: string }[] }).marks ?? []
      const hasCode = marks.some((m) => m.type === 'code')
      if (hasCode) {
        expect(marks).toEqual([{ type: 'code' }])
      }
    }
  })
})

describe('mdToBlocks — frontmatter', () => {
  it('extracts title/slug/description', () => {
    const md = '---\ntitle: Hello\nslug: hi\ndescription: "A test"\n---\n\n# Body'
    const { fields, body } = parseFrontmatter(md)
    expect(fields).toEqual({ title: 'Hello', slug: 'hi', description: 'A test' })
    expect(body.startsWith('\n# Body')).toBe(true)
  })

  it('strips frontmatter when parsing', () => {
    const md = '---\ntitle: x\n---\n\n# Body'
    const doc = mdToDoc(md)
    expect(doc.content[0]?.attrs.blockType).toBe('heading')
  })
})

describe('blocksToMd — basic blocks', () => {
  const doc: DocJSON = {
    type: 'doc',
    content: [
      block('heading', { level: 1 }, [text('Title')]),
      block('text', {}, [
        text('Para with '),
        text('bold', [{ type: 'bold' }]),
        text(' and '),
        text('italic', [{ type: 'italic' }]),
        text('.'),
      ]),
      block('bulletListItem', { level: 1 }, [text('one')]),
      block('bulletListItem', { level: 2 }, [text('nested')]),
      block('numberedListItem', { level: 1 }, [text('first')]),
      block('todoListItem', { level: 1, checked: true }, [text('done')]),
      block('quote', {}, [text('quoted')]),
      block('codeBlock', { codeLanguage: 'ts' }, [text('const x = 1')]),
      block('divider'),
      block('callout', { calloutVariant: 'tip' }, [text('Pro tip')]),
      block('embed', {
        embedUrl: 'https://www.youtube.com/watch?v=abcdefg',
        embedProvider: 'youtube',
      }),
      block('image', { imageUrl: 'https://x.com/y.png', imageWidth: 600, imageAlign: 'left' }),
    ] as never,
  }

  it('produces expected markdown shape', () => {
    const md = blocksToMd(doc)
    expect(md).toContain('# Title')
    expect(md).toContain('Para with **bold** and *italic*')
    expect(md).toContain('- one')
    expect(md).toContain('  - nested')
    expect(md).toContain('1. first')
    expect(md).toContain('- [x] done')
    expect(md).toContain('> quoted')
    expect(md).toContain('```ts\nconst x = 1\n```')
    expect(md).toContain('---')
    expect(md).toContain(':::tip\nPro tip\n:::')
    expect(md).toContain('::embed{url="https://www.youtube.com/watch?v=abcdefg"')
    expect(md).toContain('![](https://x.com/y.png){width=600 align=left}')
  })
})

describe('round-trip', () => {
  it('preserves block types across mdToBlocks(blocksToMd(doc))', () => {
    const original: DocJSON = {
      type: 'doc',
      content: [
        block('heading', { level: 2 }, [text('Setup')]),
        block('text', {}, [text('Install '), text('the', [{ type: 'bold' }]), text(' deps.')]),
        block('bulletListItem', { level: 1 }, [text('one')]),
        block('bulletListItem', { level: 1 }, [text('two')]),
        block('codeBlock', { codeLanguage: 'bash' }, [text('pnpm install')]),
        block('callout', { calloutVariant: 'warn' }, [text('Heads up.')]),
        block('quote', {}, [text('Cited.')]),
        block('divider'),
      ] as never,
    }

    const md = blocksToMd(original)
    const reparsed = mdToDoc(md)

    const types = (d: DocJSON) => d.content.map((b) => b.attrs.blockType)
    expect(types(reparsed)).toEqual(types(original))
  })

  it('preserves placeholders across the round-trip', () => {
    const md = 'Hi {{first_name}}, your order is ready.'
    const doc = mdToDoc(md)
    const out = blocksToMd(doc)
    expect(out).toContain('{{first_name}}')
  })
})

describe('mdToBlocks — inline references', () => {
  it('parses @[id] into a reference inline node', () => {
    const doc = mdToDoc('See @[user:abc] for context.')
    const inline = doc.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'reference', attrs: { id: 'user:abc' } },
      { type: 'text', text: ' for context.' },
    ])
  })

  it('parses RecordId-shaped [Title](id) links as references', () => {
    const doc = mdToDoc('Open [Settings](user:abc) to continue.')
    const inline = doc.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'Open ' },
      { type: 'reference', attrs: { id: 'user:abc' } },
      { type: 'text', text: ' to continue.' },
    ])
  })

  it('keeps http(s) links as ordinary link marks', () => {
    const doc = mdToDoc('[Docs](https://example.com) here.')
    const inline = doc.content[0]?.content ?? []
    const link = inline[0] as {
      type: string
      marks?: { type: string; attrs?: { href?: string } }[]
    }
    expect(link.type).toBe('text')
    expect(link.marks?.[0]?.type).toBe('link')
    expect(link.marks?.[0]?.attrs?.href).toBe('https://example.com')
  })

  it('keeps mailto/tel links as ordinary link marks', () => {
    const doc = mdToDoc('[email](mailto:a@b.com) [phone](tel:+1-555-0100)')
    const inline = doc.content[0]?.content ?? []
    for (const node of inline) {
      if ((node as { type?: string }).type !== 'text') continue
      const marks = (node as { marks?: { type: string }[] }).marks ?? []
      // Reference nodes won't have a `link` mark; ordinary text won't either.
      // Anything that DOES have a link mark must be the mailto/tel.
      const link = marks.find((m) => m.type === 'link')
      if (link) {
        const href = (link as { attrs?: { href?: string } }).attrs?.href ?? ''
        expect(/^(mailto|tel):/.test(href)).toBe(true)
      }
    }
    // No reference node leaked in.
    expect(inline.some((n) => (n as { type?: string }).type === 'reference')).toBe(false)
  })

  it('round-trips a doc with a reference back to the same node', () => {
    const original: DocJSON = {
      type: 'doc',
      content: [
        block('text', {}, [
          text('See '),
          { type: 'reference', attrs: { id: 'user:abc' } },
          text(' first.'),
        ]),
      ] as never,
    }
    const md = blocksToMd(original)
    const reparsed = mdToDoc(md)
    const inline = reparsed.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'reference', attrs: { id: 'user:abc' } },
      { type: 'text', text: ' first.' },
    ])
  })

  it('handles two references in the same paragraph', () => {
    const doc = mdToDoc('Both @[user:a] and @[toolset:mail] are involved.')
    const inline = doc.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'Both ' },
      { type: 'reference', attrs: { id: 'user:a' } },
      { type: 'text', text: ' and ' },
      { type: 'reference', attrs: { id: 'toolset:mail' } },
      { type: 'text', text: ' are involved.' },
    ])
  })

  it('ignores @[…] that does not look like a RecordId', () => {
    const doc = mdToDoc('Plain @[not a record] should stay text.')
    const inline = doc.content[0]?.content ?? []
    expect(inline.some((n) => (n as { type?: string }).type === 'reference')).toBe(false)
  })

  it('parses simple field chips (id contains a second colon)', () => {
    const doc = mdToDoc('Read @[field:ticket:status] before replying.')
    const inline = doc.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'Read ' },
      { type: 'reference', attrs: { id: 'field:ticket:status' } },
      { type: 'text', text: ' before replying.' },
    ])
  })

  it('parses relationship-path field chips (`::` separator)', () => {
    const doc = mdToDoc('Look at @[field:ticket:assignee::user:name] for ownership.')
    const inline = doc.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'Look at ' },
      { type: 'reference', attrs: { id: 'field:ticket:assignee::user:name' } },
      { type: 'text', text: ' for ownership.' },
    ])
  })

  it('round-trips a field-chip reference through blocksToMd/mdToBlocks', () => {
    const original: DocJSON = {
      type: 'doc',
      content: [
        block('text', {}, [
          text('Set '),
          { type: 'reference', attrs: { id: 'field:ticket:status' } },
          text(' to closed.'),
        ]),
      ] as never,
    }
    const md = blocksToMd(original)
    const reparsed = mdToDoc(md)
    const inline = reparsed.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'Set ' },
      { type: 'reference', attrs: { id: 'field:ticket:status' } },
      { type: 'text', text: ' to closed.' },
    ])
  })

  it('round-trips a path-form field chip through blocksToMd/mdToBlocks', () => {
    const original: DocJSON = {
      type: 'doc',
      content: [
        block('text', {}, [
          text('Owner is '),
          { type: 'reference', attrs: { id: 'field:ticket:assignee::user:name' } },
          text('.'),
        ]),
      ] as never,
    }
    const md = blocksToMd(original)
    const reparsed = mdToDoc(md)
    const inline = reparsed.content[0]?.content ?? []
    expect(inline).toEqual([
      { type: 'text', text: 'Owner is ' },
      { type: 'reference', attrs: { id: 'field:ticket:assignee::user:name' } },
      { type: 'text', text: '.' },
    ])
  })
})
