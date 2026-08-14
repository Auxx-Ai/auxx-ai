// packages/lib/src/import/resolution/resolvers/__tests__/url.test.ts

import { describe, expect, it } from 'vitest'
import { fieldValueSchemas } from '../../../../field-values/field-value-validator'
import { resolveUrl } from '../url'

const config = {} as never

describe('resolveUrl (url:value)', () => {
  it('preserves scheme and path (unlike domain:value)', () => {
    const result = resolveUrl('https://acme.com/pricing?x=1', config)
    expect(result).toEqual({ type: 'value', value: 'https://acme.com/pricing?x=1' })
  })

  it('prefixes https:// and lowercases, matching the write path', () => {
    const result = resolveUrl('Acme.COM/Pricing', config)
    expect(result.type).toBe('value')
    expect(result.value).toBe('https://acme.com/pricing')
  })

  it('round-trips: resolver output is byte-identical to the write-path normalization', () => {
    const raw = 'WWW.Example.com/Path'
    const resolved = resolveUrl(raw, config)
    const written = fieldValueSchemas.url.safeParse(raw)
    expect(written.success).toBe(true)
    expect(resolved.value).toBe(written.success ? written.data : undefined)
    // And a re-import of the stored value is a no-op transform.
    const reResolved = resolveUrl(String(resolved.value), config)
    expect(reResolved.value).toBe(resolved.value)
  })

  it('returns null for a blank cell', () => {
    expect(resolveUrl('   ', config)).toEqual({ type: 'value', value: null })
  })

  it('errors on an unparseable URL', () => {
    const result = resolveUrl('ht tp://not a url', config)
    expect(result.type).toBe('error')
    expect(result.error).toContain('Invalid URL')
  })
})
