// packages/lib/src/import/resolution/resolvers/__tests__/phone.test.ts

import { describe, expect, it } from 'vitest'
import { fieldValueSchemas } from '../../../../field-values/field-value-validator'
import { normalizeForLookup } from '../../../../field-values/normalize-for-lookup'
import { resolvePhone } from '../phone'

const config = {} as never

describe('resolvePhone (phone:value)', () => {
  it('normalizes a US national number to E.164', () => {
    expect(resolvePhone('(415) 555-1234', config)).toEqual({
      type: 'value',
      value: '+14155551234',
    })
  })

  it('accepts an international number (the resolver/validator mismatch this fixes)', () => {
    const raw = '+49 30 901820'
    const resolved = resolvePhone(raw, config)
    expect(resolved).toEqual({ type: 'value', value: '+4930901820' })
    // Previously the resolver emitted `+4930901820` and the write validator then
    // rejected it mid-import. Both sides must now agree.
    const written = fieldValueSchemas.phone.safeParse(raw)
    expect(written.success).toBe(true)
    expect(written.success ? written.data : null).toBe(resolved.value)
  })

  it('round-trips: resolver output is byte-identical to the write-path normalization', () => {
    const raw = '415.555.1234'
    const resolved = resolvePhone(raw, config)
    const written = fieldValueSchemas.phone.safeParse(raw)
    expect(written.success).toBe(true)
    expect(resolved.value).toBe(written.success ? written.data : undefined)
    // A re-import of the stored value is a no-op transform.
    expect(resolvePhone(String(resolved.value), config).value).toBe(resolved.value)
  })

  it('agrees with read-side lookup normalization', () => {
    const raw = '(415) 555-1234'
    expect(normalizeForLookup('PHONE_INTL', raw)).toBe(resolvePhone(raw, config).value)
  })

  it('returns null for a blank cell', () => {
    expect(resolvePhone('   ', config)).toEqual({ type: 'value', value: null })
  })

  it('errors on an unparseable number', () => {
    const result = resolvePhone('12345', config)
    expect(result.type).toBe('error')
    expect(result.error).toContain('Invalid phone number')
  })

  it('errors on a number the old digit-count check would have accepted', () => {
    // 7–15 digits passed the old length gate; `isValid()` rejects the prefix.
    expect(resolvePhone('0123456789', config).type).toBe('error')
  })
})
