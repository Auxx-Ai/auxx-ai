// packages/utils/src/__tests__/url.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildAuxxArticleUrl,
  interpolateTemplate,
  isAuxxUrl,
  parseAuxxArticleUrl,
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
