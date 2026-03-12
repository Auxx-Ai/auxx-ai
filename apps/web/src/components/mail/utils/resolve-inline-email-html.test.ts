// apps/web/src/components/mail/utils/resolve-inline-email-html.test.ts

import { describe, expect, it } from 'vitest'
import { normalizeContentId, resolveInlineEmailHtml } from './resolve-inline-email-html'

/**
 * Tests for inline email image HTML rewriting.
 */
describe('resolveInlineEmailHtml', () => {
  /**
   * Rewrites matching cid image sources to the authenticated email attachment route.
   */
  it('rewrites matching cid image sources', () => {
    const html = '<p>Hello</p><img src="cid:image001.png@01DB90A5.12345670" alt="inline" />'

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_123',
        name: 'image001.png',
        mimeType: 'image/png',
        size: 123,
        url: null,
        inline: true,
        contentId: 'image001.png@01DB90A5.12345670',
      },
    ])

    expect(resolvedHtml).toContain('src="/api/email-attachments/att_123"')
  })

  /**
   * Leaves unmatched cid image sources untouched.
   */
  it('leaves unmatched cid image sources untouched', () => {
    const html = '<img src="cid:missing-image" alt="missing" />'

    const resolvedHtml = resolveInlineEmailHtml(html, [])

    expect(resolvedHtml).toBe(html)
  })
})

/**
 * Tests for content ID normalization.
 */
describe('normalizeContentId', () => {
  /**
   * Normalizes encoded content IDs with angle brackets.
   */
  it('normalizes angle brackets and URI encoding', () => {
    expect(normalizeContentId('%3CInline-Image%40Example%3E')).toBe('inline-image@example')
  })
})
