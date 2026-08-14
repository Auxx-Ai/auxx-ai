// packages/lib/src/field-values/__tests__/phone-e164.test.ts

import { describe, expect, it } from 'vitest'
import { fieldValueSchemas } from '../field-value-validator'
import { normalizeForLookup } from '../normalize-for-lookup'

/**
 * The write path (`fieldValueSchemas.phone`) and the read-side lookup key
 * (`normalizeForLookup`) share one normalizer by construction — these tests
 * pin the E.164 behavior and the lockstep between them.
 */
describe('phone write-path normalization (E.164)', () => {
  it('accepts an international number', () => {
    // The regression test: the previous US-only normalizer rejected every
    // number that was not 10 digits, or 11 digits starting with 1.
    const result = fieldValueSchemas.phone.safeParse('+49 30 901820')
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe('+4930901820')
  })

  it('infers US for national input', () => {
    const result = fieldValueSchemas.phone.safeParse('(415) 555-1234')
    expect(result.success && result.data).toBe('+14155551234')
  })

  it('leaves an already-normalized value unchanged', () => {
    const result = fieldValueSchemas.phone.safeParse('+14155551234')
    expect(result.success && result.data).toBe('+14155551234')
  })

  it('rejects invalid numbers instead of blessing them with a +1', () => {
    expect(fieldValueSchemas.phone.safeParse('12345').success).toBe(false)
    expect(fieldValueSchemas.phone.safeParse('0123456789').success).toBe(false)
    expect(fieldValueSchemas.phone.safeParse('not a phone').success).toBe(false)
  })
})

describe('normalizeForLookup PHONE_INTL', () => {
  it.each([
    ['(415) 555-1234'],
    ['415.555.1234'],
    ['+1 415 555 1234'],
    ['+49 30 901820'],
  ])('agrees with the write path for %s', (raw) => {
    const written = fieldValueSchemas.phone.safeParse(raw)
    expect(written.success).toBe(true)
    expect(normalizeForLookup('PHONE_INTL', raw)).toBe(written.success ? written.data : null)
  })

  it('returns null for a value the write path would reject (skip the candidate)', () => {
    expect(normalizeForLookup('PHONE_INTL', '12345')).toBeNull()
  })
})
