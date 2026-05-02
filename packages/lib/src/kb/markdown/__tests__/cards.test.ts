// packages/lib/src/kb/markdown/__tests__/cards.test.ts

import { describe, expect, it } from 'vitest'
import { blocksToMd } from '../blocks-to-md'
import { mdToBlocks } from '../md-to-blocks'
import type { DocJSON } from '../types'

describe('cards markdown serialization', () => {
  it('renders a cards block to :::cards / ::card directives', () => {
    const doc: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'block',
          attrs: {
            blockType: 'cards',
            cards: [
              {
                id: 'c1',
                title: 'Getting Started',
                href: '/getting-started',
                iconId: 'rocket',
                description: 'Set up your account in minutes',
              },
              {
                id: 'c2',
                title: 'API Reference',
                href: 'auxx://kb/article/abc123',
                iconId: 'code',
              },
            ],
          },
          content: [],
        },
      ],
    }
    const md = blocksToMd(doc)
    expect(md).toContain(':::cards')
    expect(md).toContain('::card{title="Getting Started"')
    expect(md).toContain('href="/getting-started"')
    expect(md).toContain('href="auxx://kb/article/abc123"')
    expect(md).toContain('icon="rocket"')
    expect(md).toContain('Set up your account in minutes')
    expect(md.trim().endsWith(':::')).toBe(true)
  })

  it('parses :::cards directive back into a cards block', () => {
    const md = `:::cards
::card{title="Docs" href="/docs" icon="file-text" description="Read the docs"}
::card{title="Reference" href="auxx://kb/article/xyz"}
:::
`
    const doc = mdToBlocks(md)
    const block = doc.content[0]
    expect(block?.attrs.blockType).toBe('cards')
    const cards = block?.attrs.cards ?? []
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({
      title: 'Docs',
      href: '/docs',
      iconId: 'file-text',
      description: 'Read the docs',
    })
    expect(cards[1]).toMatchObject({
      title: 'Reference',
      href: 'auxx://kb/article/xyz',
    })
  })

  it('round-trips the structure (auxx:// hrefs and icons survive)', () => {
    const original: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'block',
          attrs: {
            blockType: 'cards',
            cards: [
              {
                id: 'c1',
                title: 'Foo',
                href: 'auxx://kb/article/abc',
                iconId: 'rocket',
              },
            ],
          },
          content: [],
        },
      ],
    }
    const md = blocksToMd(original)
    const reparsed = mdToBlocks(md)
    const card = reparsed.content[0]?.attrs.cards?.[0]
    expect(card?.title).toBe('Foo')
    expect(card?.href).toBe('auxx://kb/article/abc')
    expect(card?.iconId).toBe('rocket')
  })
})
