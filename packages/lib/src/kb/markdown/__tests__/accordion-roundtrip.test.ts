// packages/lib/src/kb/markdown/__tests__/accordion-roundtrip.test.ts

import { describe, expect, it } from 'vitest'
import { blocksToMd } from '../blocks-to-md'
import { mdToBlocks } from '../md-to-blocks'
import { accordionAt, blockAt, panelAt } from '../test-helpers'
import type { DocJSON } from '../types'

const mdToDoc = (md: string): DocJSON => ({ type: 'doc', content: mdToBlocks(md) })

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
    const reparsed = mdToDoc(md)
    const accordion = accordionAt(reparsed.content)
    expect(accordion.attrs.allowMultiple).toBe(false)
    expect(accordion.content).toHaveLength(2)
    expect(panelAt(accordion, 0).attrs.label).toBe('What is auxx.ai?')
    expect(blockAt(panelAt(accordion, 1).content).attrs.blockType).toBe('heading')
  })
})

describe('details HTML import alias (Q6d)', () => {
  it('converts a single <details>/<summary> into an accordion', () => {
    const md = '<details><summary>Why?</summary>Because.</details>\n'
    const doc = mdToDoc(md)
    const node = accordionAt(doc.content)
    expect(node.attrs.allowMultiple).toBe(true)
    expect(node.content).toHaveLength(1)
    expect(panelAt(node, 0).attrs.label).toBe('Why?')
  })

  it('merges consecutive <details> blocks into one accordion', () => {
    const md = `<details><summary>Q1</summary>A1</details>

<details><summary>Q2</summary>A2</details>
`
    const doc = mdToDoc(md)
    expect(doc.content).toHaveLength(1)
    const node = accordionAt(doc.content)
    expect(node.content).toHaveLength(2)
    expect(panelAt(node, 0).attrs.label).toBe('Q1')
    expect(panelAt(node, 1).attrs.label).toBe('Q2')
  })

  it('serializer never re-emits <details> — converted accordion uses :::accordion', () => {
    const md = '<details><summary>Q</summary>A</details>\n'
    const doc = mdToDoc(md)
    const out = blocksToMd(doc)
    expect(out).toContain('::::accordion')
    expect(out).not.toContain('<details>')
  })
})
