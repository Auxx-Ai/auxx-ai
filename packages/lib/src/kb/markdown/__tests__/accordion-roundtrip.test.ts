// packages/lib/src/kb/markdown/__tests__/accordion-roundtrip.test.ts

import { describe, expect, it } from 'vitest'
import { blocksToMd } from '../blocks-to-md'
import { mdToBlocks } from '../md-to-blocks'
import type { AccordionJSON, DocJSON } from '../types'

function makeAccordionDoc(allowMultiple = true): DocJSON {
  return {
    type: 'doc',
    content: [
      {
        type: 'accordion',
        attrs: { allowMultiple },
        content: [
          {
            type: 'panel',
            attrs: { id: 'q1', label: 'What is auxx.ai?' },
            content: [
              {
                type: 'block',
                attrs: { blockType: 'text' },
                content: [{ type: 'text', text: 'A CRM helpdesk.' }],
              },
            ],
          },
          {
            type: 'panel',
            attrs: { id: 'q2', label: 'How do I get started?' },
            content: [
              {
                type: 'block',
                attrs: { blockType: 'heading', level: 1 },
                content: [{ type: 'text', text: 'Sign up' }],
              },
              {
                type: 'block',
                attrs: { blockType: 'text' },
                content: [{ type: 'text', text: 'Then connect your inbox.' }],
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('accordion markdown serialization', () => {
  it('renders an accordion with default allowMultiple omitted from header', () => {
    const md = blocksToMd(makeAccordionDoc(true))
    expect(md).toContain('::::accordion')
    // No `multiple=` token when default (true).
    expect(md).not.toContain('multiple=')
    expect(md).toContain(':::item{label="What is auxx.ai?"}')
  })

  it('emits multiple=false when allowMultiple is false', () => {
    const md = blocksToMd(makeAccordionDoc(false))
    expect(md).toContain('::::accordion{multiple=false}')
  })

  it('round-trips allowMultiple=false', () => {
    const md = blocksToMd(makeAccordionDoc(false))
    const reparsed = mdToBlocks(md)
    const accordion = reparsed.content[0] as AccordionJSON
    expect(accordion.type).toBe('accordion')
    expect(accordion.attrs.allowMultiple).toBe(false)
    expect(accordion.content).toHaveLength(2)
    expect(accordion.content[0].attrs.label).toBe('What is auxx.ai?')
    expect(accordion.content[1].content[0].attrs.blockType).toBe('heading')
  })
})

describe('details HTML import alias (Q6d)', () => {
  it('converts a single <details>/<summary> into an accordion', () => {
    const md = '<details><summary>Why?</summary>Because.</details>\n'
    const doc = mdToBlocks(md)
    const node = doc.content[0] as AccordionJSON
    expect(node.type).toBe('accordion')
    expect(node.attrs.allowMultiple).toBe(true)
    expect(node.content).toHaveLength(1)
    expect(node.content[0].attrs.label).toBe('Why?')
  })

  it('merges consecutive <details> blocks into one accordion', () => {
    const md = `<details><summary>Q1</summary>A1</details>

<details><summary>Q2</summary>A2</details>
`
    const doc = mdToBlocks(md)
    expect(doc.content).toHaveLength(1)
    const node = doc.content[0] as AccordionJSON
    expect(node.type).toBe('accordion')
    expect(node.content).toHaveLength(2)
    expect(node.content[0].attrs.label).toBe('Q1')
    expect(node.content[1].attrs.label).toBe('Q2')
  })

  it('serializer never re-emits <details> — converted accordion uses :::accordion', () => {
    const md = '<details><summary>Q</summary>A</details>\n'
    const doc = mdToBlocks(md)
    const out = blocksToMd(doc)
    expect(out).toContain('::::accordion')
    expect(out).not.toContain('<details>')
  })
})
