// packages/utils/src/__tests__/contact.test.ts

import { describe, expect, it } from 'vitest'
import { formatPhoneNumber, parseValidPhone } from '../contact'

describe('formatPhoneNumber', () => {
  describe('US national numbers (the default country)', () => {
    it('normalizes a bare 10-digit number to E.164', () => {
      expect(formatPhoneNumber('4155551234')).toBe('+14155551234')
    })

    it('normalizes formatted input', () => {
      expect(formatPhoneNumber('(415) 555-1234')).toBe('+14155551234')
      expect(formatPhoneNumber('415.555.1234')).toBe('+14155551234')
      expect(formatPhoneNumber('415-555-1234 ')).toBe('+14155551234')
    })

    it('normalizes an 11-digit number that already carries the country code', () => {
      expect(formatPhoneNumber('14155551234')).toBe('+14155551234')
      expect(formatPhoneNumber('+1 415 555 1234')).toBe('+14155551234')
    })

    it('returns already-E.164 values unchanged (migration is a no-op on clean rows)', () => {
      expect(formatPhoneNumber('+14155551234')).toBe('+14155551234')
    })
  })

  describe('international numbers (rejected by the old US-only normalizer)', () => {
    it('parses a German number without coercing it to US', () => {
      expect(formatPhoneNumber('+49 30 901820')).toBe('+4930901820')
    })

    it('parses UK and Australian numbers', () => {
      expect(formatPhoneNumber('+44 20 7183 8750')).toBe('+442071838750')
      expect(formatPhoneNumber('+61 2 8015 5555')).toBe('+61280155555')
    })

    it('honors an explicit default country for national input', () => {
      expect(formatPhoneNumber('030 901820', 'DE')).toBe('+4930901820')
    })
  })

  describe('invalid input', () => {
    it('returns null for empty input', () => {
      expect(formatPhoneNumber(null)).toBeNull()
      expect(formatPhoneNumber('')).toBeNull()
      expect(formatPhoneNumber('   ')).toBeNull()
    })

    it('returns null for too-short numbers', () => {
      expect(formatPhoneNumber('12345')).toBeNull()
    })

    it('returns null for garbage', () => {
      expect(formatPhoneNumber('not a phone')).toBeNull()
      expect(formatPhoneNumber('++++')).toBeNull()
    })

    it('rejects impossible US numbers the old algorithm blessed with a +1', () => {
      // 10 digits, so the old normalizer returned `+10123456789`-style junk.
      expect(formatPhoneNumber('0123456789')).toBeNull()
      expect(formatPhoneNumber('1111111111')).toBeNull()
    })

    it('returns null for an unknown country calling code', () => {
      expect(formatPhoneNumber('+999 1234567')).toBeNull()
    })
  })
})

describe('parseValidPhone', () => {
  it('returns the parsed number, not just the E.164 string', () => {
    // The reason this exists alongside formatPhoneNumber: callers need the parts.
    // `phoneSearchPatterns` wants `nationalNumber`, `lookupPhoneGeo` wants
    // `countryCallingCode` + `nationalNumber` + `country`.
    const parsed = parseValidPhone('+13102030000')
    expect(parsed?.number).toBe('+13102030000')
    expect(parsed?.nationalNumber).toBe('3102030000')
    expect(parsed?.countryCallingCode).toBe('1')
    expect(parsed?.country).toBe('US')
  })

  it('honors an explicit region for national input', () => {
    expect(parseValidPhone('030 901820', 'DE')?.number).toBe('+4930901820')
  })

  it('applies the isValid gate, not a bare parse', () => {
    // `parsePhoneNumberFromString('415', 'US')` returns a PhoneNumber for `+1415`.
    // Letting that through would invent a `1415` search pattern that matches
    // `+13161415000` — a false positive nobody typed.
    expect(parseValidPhone('415')).toBeNull()
    expect(parseValidPhone('0123456789')).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['garbage', 'not a phone'],
  ])('returns null for %s', (_label, input) => {
    expect(parseValidPhone(input)).toBeNull()
  })

  it('agrees with formatPhoneNumber on every verdict', () => {
    // The two must never disagree — formatPhoneNumber is defined over this.
    for (const input of ['+13102030000', '4155551234', '415', 'not a phone', '', '+999 1234567']) {
      expect(parseValidPhone(input)?.number ?? null).toBe(formatPhoneNumber(input))
    }
  })
})
