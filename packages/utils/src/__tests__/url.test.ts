// packages/utils/src/__tests__/url.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildAuxxArticleUrl,
  interpolateTemplate,
  interpolateUrlTemplate,
  isAuxxUrl,
  parseAuxxArticleUrl,
  UnsafeUrlTemplateError,
  unresolvedPlaceholders,
} from '../url'

describe('buildAuxxArticleUrl', () => {
  it('builds the canonical URI', () => {
    expect(buildAuxxArticleUrl('abc123')).toBe('auxx://kb/article/abc123')
  })
})

describe('parseAuxxArticleUrl', () => {
  it('round-trips a built URL', () => {
    const ref = parseAuxxArticleUrl(buildAuxxArticleUrl('abc123'))
    expect(ref).toEqual({ kind: 'kb-article', articleId: 'abc123' })
  })

  it('returns null for non-matching prefix', () => {
    expect(parseAuxxArticleUrl('https://example.com')).toBeNull()
    expect(parseAuxxArticleUrl('auxx://record/abc')).toBeNull()
    expect(parseAuxxArticleUrl('auxx://kb/folder/abc')).toBeNull()
  })

  it('returns null for empty id', () => {
    expect(parseAuxxArticleUrl('auxx://kb/article/')).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(parseAuxxArticleUrl(null)).toBeNull()
    expect(parseAuxxArticleUrl(undefined)).toBeNull()
  })
})

describe('isAuxxUrl', () => {
  it('matches any auxx-prefixed URL', () => {
    expect(isAuxxUrl('auxx://kb/article/abc')).toBe(true)
    expect(isAuxxUrl('auxx://record/123')).toBe(true)
  })

  it('rejects external URLs', () => {
    expect(isAuxxUrl('https://example.com')).toBe(false)
    expect(isAuxxUrl('mailto:a@b.com')).toBe(false)
    expect(isAuxxUrl('')).toBe(false)
    expect(isAuxxUrl(null)).toBe(false)
  })
})

describe('interpolateTemplate', () => {
  it('substitutes {key} placeholders from the vars map', () => {
    expect(interpolateTemplate('https://{shop}.myshopify.com', { shop: 'acme' })).toBe(
      'https://acme.myshopify.com'
    )
  })

  it('substitutes every occurrence of a key', () => {
    expect(interpolateTemplate('{a}/{a}', { a: 'x' })).toBe('x/x')
  })

  it('does not encode by default (a value may itself be a URL)', () => {
    expect(interpolateTemplate('{base}/rest', { base: 'https://x.supabase.co' })).toBe(
      'https://x.supabase.co/rest'
    )
  })

  it('URI-encodes when encode:true', () => {
    expect(interpolateTemplate('?q={v}', { v: 'a b&c' }, { encode: true })).toBe('?q=a%20b%26c')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(interpolateTemplate('{a}-{b}', { a: '1' })).toBe('1-{b}')
  })
})

describe('unresolvedPlaceholders', () => {
  it('returns placeholder names that remain', () => {
    expect(unresolvedPlaceholders('https://{shop}.x/{path}')).toEqual(['shop', 'path'])
  })

  it('returns empty for a fully-resolved string', () => {
    expect(unresolvedPlaceholders('https://acme.x/orders')).toEqual([])
  })
})

describe('interpolateUrlTemplate', () => {
  const shopify = 'https://{shop}.myshopify.com/admin/api/2024-10'

  it('interpolates a valid host-position value', () => {
    expect(interpolateUrlTemplate(shopify, { shop: 'acme-store' })).toBe(
      'https://acme-store.myshopify.com/admin/api/2024-10'
    )
  })

  it.each([
    'evil.com/x?',
    'evil.com#',
    'evil.com?',
    'user@evil.com',
    'evil.com:443/',
    'a\\b',
    'x y',
  ])('rejects %j in a pinned host', (shop) => {
    expect(() => interpolateUrlTemplate(shopify, { shop })).toThrow(UnsafeUrlTemplateError)
  })

  it('leaves a template whose whole host is one placeholder to the tenant', () => {
    expect(interpolateUrlTemplate('https://{domain}/api', { domain: 'my.host.io' })).toBe(
      'https://my.host.io/api'
    )
  })

  it('leaves a whole-URL placeholder raw', () => {
    expect(interpolateUrlTemplate('{value}', { value: 'https://x.supabase.co/rest/v1' })).toBe(
      'https://x.supabase.co/rest/v1'
    )
  })

  it('does not validate path-position values', () => {
    expect(interpolateUrlTemplate('https://api.x.com/{account}/v1', { account: 'a:b' })).toBe(
      'https://api.x.com/a:b/v1'
    )
  })
})
