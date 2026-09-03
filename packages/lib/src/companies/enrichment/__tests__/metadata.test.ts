// packages/lib/src/companies/enrichment/__tests__/metadata.test.ts
// The value-sanity half of enrichment. A homepage is arbitrary third-party HTML, and
// everything extracted from one lands on a customer's record, so nothing gets out of the
// module without passing these.

import { describe, expect, it } from 'vitest'
import { cleanText, emptyMetadata, isEmptyMetadata } from '../metadata'

describe('cleanText', () => {
  it('trims, and collapses the multi-line whitespace a pretty-printed <title> carries', () => {
    expect(cleanText('  Acme\n   Industries  ', 2, 120)).toBe('Acme Industries')
  })

  it('strips zero-width characters that survive trim', () => {
    expect(cleanText('\u200BAcme\uFEFF', 2, 120)).toBe('Acme')
  })

  it('returns null for empty, whitespace-only, and non-string input', () => {
    expect(cleanText('', 2, 120)).toBeNull()
    expect(cleanText('   ', 2, 120)).toBeNull()
    expect(cleanText('\u200B\u200C', 2, 120)).toBeNull()
    expect(cleanText(null, 2, 120)).toBeNull()
    expect(cleanText(undefined, 2, 120)).toBeNull()
  })

  it('returns null below the minimum length', () => {
    expect(cleanText('A', 2, 120)).toBeNull()
    expect(cleanText('too short', 20, 500)).toBeNull()
  })

  it('truncates with an ellipsis above the maximum', () => {
    const out = cleanText('x'.repeat(200), 2, 10)
    expect(out).toBe(`${'x'.repeat(9)}…`)
    expect(out).toHaveLength(10)
  })
})

describe('isEmptyMetadata', () => {
  it('is true for a fetch that produced nothing', () => {
    expect(isEmptyMetadata(emptyMetadata())).toBe(true)
  })

  it('is false as soon as a content field survived', () => {
    expect(isEmptyMetadata({ ...emptyMetadata(), siteName: 'Acme' })).toBe(false)
    expect(isEmptyMetadata({ ...emptyMetadata(), description: 'x'.repeat(30) })).toBe(false)
  })

  // 🛑 `faviconUrl` falls back to a hard-coded `/favicon.ico` guess, so it is non-null for
  // ANY page that was fetched at all. If it counted here, a site whose title was a bot wall
  // and whose description was missing would be recorded `enriched` and locked out for 30
  // days instead of `failed` and retried in 7. Whether an image was usable is answered by
  // the stored asset id, which the caller checks alongside this.
  it('ignores the speculative image candidates', () => {
    expect(
      isEmptyMetadata({ ...emptyMetadata(), faviconUrl: 'https://acme.com/favicon.ico' })
    ).toBe(true)
    expect(isEmptyMetadata({ ...emptyMetadata(), ogImageUrl: 'https://acme.com/og.png' })).toBe(
      true
    )
  })
})
