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

    expect(resolvedHtml).toContain('src="/api/attachments/att_123/content"')
  })

  /**
   * Leaves unmatched cid image sources untouched.
   */
  it('leaves unmatched cid image sources untouched', () => {
    const html = '<img src="cid:missing-image" alt="missing" />'

    const resolvedHtml = resolveInlineEmailHtml(html, [])

    expect(resolvedHtml).toBe(html)
  })

  /**
   * Rewrites unquoted cid: src attributes.
   */
  it('rewrites unquoted src=cid: references', () => {
    const html = '<img src=cid:image001.png@01DB90A5.12345670 alt="inline" />'

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_456',
        name: 'image001.png',
        mimeType: 'image/png',
        size: 123,
        url: null,
        inline: true,
        contentId: 'image001.png@01DB90A5.12345670',
      },
    ])

    expect(resolvedHtml).toContain('src="/api/attachments/att_456/content"')
  })

  /**
   * Rewrites CSS url(cid:...) references.
   */
  it('rewrites CSS url(cid:...) background images', () => {
    const html = '<div style="background-image: url(cid:bg001@example.com);">content</div>'

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_789',
        name: 'background.png',
        mimeType: 'image/png',
        size: 456,
        url: null,
        inline: true,
        contentId: 'bg001@example.com',
      },
    ])

    expect(resolvedHtml).toContain("url('/api/attachments/att_789/content')")
  })

  /**
   * Leaves remote http(s) URLs untouched.
   */
  it('leaves remote URLs untouched', () => {
    const html =
      '<img src="https://example.com/logo.png" /><div style="background-image: url(https://ci3.googleusercontent.com/proxy);">x</div>'

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_999',
        name: 'logo.png',
        mimeType: 'image/png',
        size: 100,
        url: null,
        inline: true,
        contentId: 'some-id',
      },
    ])

    expect(resolvedHtml).toBe(html)
  })

  /**
   * Rewrites single-quoted cid: src attributes.
   */
  it("rewrites single-quoted src='cid:...' references", () => {
    const html = "<img src='cid:logo@company.com' alt='logo' />"

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_sq',
        name: 'logo.png',
        mimeType: 'image/png',
        size: 200,
        url: null,
        inline: true,
        contentId: 'logo@company.com',
      },
    ])

    expect(resolvedHtml).toContain("src='/api/attachments/att_sq/content'")
  })

  /**
   * Leaves Gmail proxy URLs untouched — these are remote URLs, not cid: references.
   */
  it('leaves Gmail proxy URLs untouched', () => {
    const html =
      '<img src="https://ci3.googleusercontent.com/proxy/abc123" /><img src="https://lh3.googleusercontent.com/a/default" />'

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_proxy',
        name: 'proxy.png',
        mimeType: 'image/png',
        size: 100,
        url: null,
        inline: true,
        contentId: 'some-id',
      },
    ])

    expect(resolvedHtml).toBe(html)
  })

  /**
   * Rewrites multiple cid: references in the same HTML.
   */
  it('rewrites multiple cid: references in the same HTML', () => {
    const html =
      '<img src="cid:img1@ex.com" /><img src="cid:img2@ex.com" /><img src="https://remote.com/logo.png" />'

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_a',
        name: 'img1.png',
        mimeType: 'image/png',
        size: 100,
        url: null,
        inline: true,
        contentId: 'img1@ex.com',
      },
      {
        id: 'att_b',
        name: 'img2.png',
        mimeType: 'image/png',
        size: 200,
        url: null,
        inline: true,
        contentId: 'img2@ex.com',
      },
    ])

    expect(resolvedHtml).toContain('src="/api/attachments/att_a/content"')
    expect(resolvedHtml).toContain('src="/api/attachments/att_b/content"')
    expect(resolvedHtml).toContain('src="https://remote.com/logo.png"')
  })

  /**
   * Only rewrites inline attachments with contentId.
   */
  it('ignores non-inline attachments', () => {
    const html = '<img src="cid:file001@example.com" />'

    const resolvedHtml = resolveInlineEmailHtml(html, [
      {
        id: 'att_noinline',
        name: 'file.pdf',
        mimeType: 'application/pdf',
        size: 1000,
        url: null,
        inline: false,
        contentId: 'file001@example.com',
      },
    ])

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

  it('strips leading cid: prefix', () => {
    expect(normalizeContentId('cid:image@example.com')).toBe('image@example.com')
  })

  it('lowercases content IDs', () => {
    expect(normalizeContentId('IMAGE@EXAMPLE.COM')).toBe('image@example.com')
  })

  it('strips angle brackets from raw content IDs', () => {
    expect(normalizeContentId('<image@example.com>')).toBe('image@example.com')
  })

  it('handles double-encoded angle brackets', () => {
    expect(normalizeContentId('%3Cimage%40example.com%3E')).toBe('image@example.com')
  })
})
