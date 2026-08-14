// packages/utils/src/__tests__/contact.test.ts

import { describe, expect, it } from 'vitest'
import { formatPhoneNumber } from '../contact'

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
