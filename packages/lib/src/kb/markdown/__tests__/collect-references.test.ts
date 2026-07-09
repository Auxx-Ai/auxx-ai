// packages/lib/src/kb/markdown/__tests__/collect-references.test.ts

import { describe, expect, it } from 'vitest'
import { collectRecordLinks } from '../collect-references'
import type { ArticleNodeJSON } from '../types'

const block = (content: ArticleNodeJSON extends never ? never : any[]): ArticleNodeJSON =>
  ({ type: 'block', attrs: { blockType: 'text' }, content }) as ArticleNodeJSON

describe('collectRecordLinks', () => {
  it('returns [] for empty/null content', () => {
    expect(collectRecordLinks(null)).toEqual([])
    expect(collectRecordLinks([])).toEqual([])
  })

  it('collects reference nodes from plain blocks with recordType split', () => {
    const nodes = [
      block([
        { type: 'text', text: 'Ask ' },
        { type: 'reference', attrs: { id: 'contact:c_1' } },
        { type: 'text', text: ' about ' },
        { type: 'reference', attrs: { id: 'company:co_9' } },
      ]),
    ]
    expect(collectRecordLinks(nodes)).toEqual([
      { recordId: 'contact:c_1', recordType: 'contact' },
      { recordId: 'company:co_9', recordType: 'company' },
    ])
  })

  it('dedupes repeated references and drops non-RecordId ids', () => {
    const nodes = [
      block([
        { type: 'reference', attrs: { id: 'contact:c_1' } },
        { type: 'reference', attrs: { id: 'contact:c_1' } },
        { type: 'reference', attrs: { id: 'not-a-record-id' } },
        { type: 'reference', attrs: {} },
      ]),
    ]
    expect(collectRecordLinks(nodes)).toEqual([{ recordId: 'contact:c_1', recordType: 'contact' }])
  })

  it('walks tabs, accordions, and tables', () => {
    const nodes: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: {},
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Tab' },
            content: [block([{ type: 'reference', attrs: { id: 'contact:in_tab' } }]) as never],
          },
        ],
      } as ArticleNodeJSON,
      {
        type: 'accordion',
        attrs: { allowMultiple: false },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p2', label: 'Section' },
            content: [
              block([{ type: 'reference', attrs: { id: 'company:in_accordion' } }]) as never,
            ],
          },
        ],
      } as ArticleNodeJSON,
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  block([{ type: 'reference', attrs: { id: 'ticket:in_table' } }]) as never,
                ],
              },
            ],
          },
        ],
      } as ArticleNodeJSON,
    ]
    expect(collectRecordLinks(nodes).map((l) => l.recordId)).toEqual([
      'contact:in_tab',
      'company:in_accordion',
      'ticket:in_table',
    ])
  })
})
