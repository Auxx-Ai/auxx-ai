// packages/lib/src/kb/markdown/__tests__/table-roundtrip.test.ts

import { describe, expect, it } from 'vitest'
import { blocksToMd } from '../blocks-to-md'
import { mdToBlocks } from '../md-to-blocks'
import { at, cellBlockAt, tableAt } from '../test-helpers'
import type { DocJSON } from '../types'

const mdToDoc = (md: string): DocJSON => ({ type: 'doc', content: mdToBlocks(md) })

function makeSimpleTableDoc(): DocJSON {
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                content: [
                  {
                    type: 'block',
                    attrs: { blockType: 'text' },
                    content: [{ type: 'text', text: 'Name' }],
                  },
                ],
              },
              {
                type: 'tableHeader',
                content: [
                  {
                    type: 'block',
                    attrs: { blockType: 'text' },
                    content: [{ type: 'text', text: 'Role' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'block',
                    attrs: { blockType: 'text' },
                    content: [{ type: 'text', text: 'Alice' }],
                  },
                ],
              },
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'block',
                    attrs: { blockType: 'text' },
                    content: [{ type: 'text', text: 'Eng' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('table markdown serialization', () => {
  it('emits a simple table as GFM', () => {
    const md = blocksToMd(makeSimpleTableDoc())
    expect(md).toContain('| Name | Role |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Alice | Eng |')
  })

  it('round-trips a simple table', () => {
    const original = makeSimpleTableDoc()
    const md = blocksToMd(original)
    const reparsed = mdToDoc(md)
    const table = tableAt(reparsed.content)
    expect(table.content).toHaveLength(2)
    expect(at(at(table.content, 0, 'table row').content, 0, 'table cell').type).toBe('tableHeader')
    expect(at(at(table.content, 1, 'table row').content, 0, 'table cell').type).toBe('tableCell')
    expect(cellBlockAt(table, 0, 0).content?.[0]?.text).toBe('Name')
    expect(cellBlockAt(table, 1, 0).content?.[0]?.text).toBe('Alice')
  })

  it('preserves inline marks in cells through GFM round-trip', () => {
    const original: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'block',
                      attrs: { blockType: 'text' },
                      content: [{ type: 'text', text: 'Heading' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'block',
                      attrs: { blockType: 'text' },
                      content: [
                        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
                        { type: 'text', text: ' and ' },
                        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const md = blocksToMd(original)
    const reparsed = mdToDoc(md)
    const table = tableAt(reparsed.content)
    const inline = cellBlockAt(table, 1, 0).content ?? []
    expect(inline.some((n) => n.marks?.some((m) => m.type === 'bold'))).toBe(true)
    expect(inline.some((n) => n.marks?.some((m) => m.type === 'italic'))).toBe(true)
  })

  it('escapes pipe characters inside cell text', () => {
    const original: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'block',
                      attrs: { blockType: 'text' },
                      content: [{ type: 'text', text: 'Pattern' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'block',
                      attrs: { blockType: 'text' },
                      content: [{ type: 'text', text: 'A | B' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const md = blocksToMd(original)
    expect(md).toContain('A \\| B')
    const reparsed = mdToDoc(md)
    const table = tableAt(reparsed.content)
    expect(cellBlockAt(table, 1, 0).content?.[0]?.text).toBe('A | B')
  })

  it('renders nothing for an empty table', () => {
    const md = blocksToMd({
      type: 'doc',
      content: [{ type: 'table', content: [] }],
    })
    expect(md.trim()).toBe('')
  })
})
