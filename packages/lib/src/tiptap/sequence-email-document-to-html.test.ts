// packages/lib/src/tiptap/sequence-email-document-to-html.test.ts

import { describe, expect, it } from 'vitest'
import { sequenceEmailDocumentToHtml } from './sequence-email-document-to-html'

describe('sequenceEmailDocumentToHtml', () => {
  it('renders concrete rich text with escaped content', () => {
    expect(
      sequenceEmailDocumentToHtml({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'center' },
            content: [
              {
                type: 'text',
                text: '<Jordan & Co>',
                marks: [{ type: 'bold' }],
              },
              { type: 'hardBreak' },
              {
                type: 'text',
                text: 'Open details',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://example.com/details?a=1&b=2' },
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toBe(
      '<p style="text-align:center"><strong>&lt;Jordan &amp; Co&gt;</strong><br><a href="https://example.com/details?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Open details</a></p>'
    )
  })

  it('fails closed for unresolved placeholders and unsafe links', () => {
    expect(() =>
      sequenceEmailDocumentToHtml({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'placeholder', attrs: { id: 'visit:date' } }],
          },
        ],
      })
    ).toThrow('Unresolved placeholder')
    expect(() =>
      sequenceEmailDocumentToHtml({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Nope',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      })
    ).toThrow('Unsafe email link')
  })
})
