// packages/utils/src/__tests__/url.test.ts

import { describe, expect, it } from 'vitest'
import { buildAuxxArticleUrl, isAuxxUrl, parseAuxxArticleUrl } from '../url'

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
