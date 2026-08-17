// packages/lib/src/ai/kopilot/capabilities/mail/__tests__/normalize-recipient-identifier.test.ts
//
// The agent send path's identifier normalizer. It used to be
// `value.replace(/[\s().-]/g, '')` — separator removal, which is only correct in
// the NANP and not even there (it never adds the `+1`). Every case below either
// produced a wrong string or a silently undeliverable one before the fix.

import { describe, expect, it } from 'vitest'
import { normalizeRecipientIdentifier } from '../recipient-resolver'

describe('normalizeRecipientIdentifier — phone', () => {
  it('produces E.164 for national US input, which the old strip never did', () => {
    // Old behavior: '4155551234' — no country code, matches no stored participant.
    expect(normalizeRecipientIdentifier('(415) 555-1234', 'PHONE', 'US')).toBe('+14155551234')
    expect(normalizeRecipientIdentifier('415.555.1234', 'PHONE', 'US')).toBe('+14155551234')
    expect(normalizeRecipientIdentifier('415-555-1234 ', 'PHONE', 'US')).toBe('+14155551234')
  })

  it('🔴 drops the trunk prefix for a region that has one — the case the strip got backwards', () => {
    // Old behavior: '030901820'. E.164 drops the leading trunk `0`, so the old
    // value was not a substring of the stored '+4930901820' either.
    expect(normalizeRecipientIdentifier('030 901820', 'PHONE', 'DE')).toBe('+4930901820')
    expect(normalizeRecipientIdentifier('020 7183 8750', 'PHONE', 'GB')).toBe('+442071838750')
  })

  it('parses the same national digits differently per region — which is why region is a parameter', () => {
    const asUs = normalizeRecipientIdentifier('020 7183 8750', 'PHONE', 'US')
    const asGb = normalizeRecipientIdentifier('020 7183 8750', 'PHONE', 'GB')
    expect(asGb).toBe('+442071838750')
    // Not merely different — the US reading is invalid, so it is refused rather
    // than blessed with a `+1`.
    expect(asUs).toBeNull()
    expect(asUs).not.toBe(asGb)
  })

  it('is idempotent on an already-E.164 value, regardless of region', () => {
    expect(normalizeRecipientIdentifier('+14155551234', 'PHONE', 'US')).toBe('+14155551234')
    expect(normalizeRecipientIdentifier('+14155551234', 'PHONE', 'DE')).toBe('+14155551234')
    expect(normalizeRecipientIdentifier('+4930901820', 'PHONE', 'US')).toBe('+4930901820')
  })

  it('returns null for numbers no numbering plan accepts, instead of a plausible string', () => {
    // The point of null: the LLM gets a resolution error it can act on, rather
    // than a send that silently goes nowhere.
    expect(normalizeRecipientIdentifier('12345', 'PHONE', 'US')).toBeNull()
    expect(normalizeRecipientIdentifier('1111111111', 'PHONE', 'US')).toBeNull()
    expect(normalizeRecipientIdentifier('not a phone', 'PHONE', 'US')).toBeNull()
    expect(normalizeRecipientIdentifier('   ', 'PHONE', 'US')).toBeNull()
  })

  it('agrees with formatPhoneNumber, because it IS formatPhoneNumber', async () => {
    // Guards against a future "quick fix" reintroducing a local strip: write and
    // lookup normalization must not drift.
    const { formatPhoneNumber } = await import('@auxx/utils')
    for (const raw of ['(415) 555-1234', '030 901820', '+442071838750', 'nonsense']) {
      for (const region of ['US', 'DE', 'GB'] as const) {
        expect(normalizeRecipientIdentifier(raw, 'PHONE', region)).toBe(
          formatPhoneNumber(raw, region)
        )
      }
    }
  })
})

describe('normalizeRecipientIdentifier — other types', () => {
  it('lowercases and trims email', () => {
    expect(normalizeRecipientIdentifier('  Jane@Corp.COM ', 'EMAIL', 'US')).toBe('jane@corp.com')
  })

  it('passes opaque provider tokens through untouched apart from trimming', () => {
    // A PSID is case-sensitive and has no canonical form to impose.
    expect(normalizeRecipientIdentifier(' 1234567890AbCd ', 'FACEBOOK_PSID', 'US')).toBe(
      '1234567890AbCd'
    )
    expect(normalizeRecipientIdentifier('Visitor_XyZ', 'CHAT_VISITOR', 'US')).toBe('Visitor_XyZ')
  })

  it('returns null for an empty value of any type', () => {
    expect(normalizeRecipientIdentifier('', 'EMAIL', 'US')).toBeNull()
    expect(normalizeRecipientIdentifier('  ', 'FACEBOOK_PSID', 'US')).toBeNull()
  })
})
