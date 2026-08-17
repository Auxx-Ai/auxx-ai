// packages/lib/src/participants/__tests__/channel-identifier-fields.test.ts
//
// The one model→identifier map. Two things are worth pinning here and nothing
// else is:
//
// 1. `platform_user` returns `[]`, and `[]` must never be read as "no filter".
//    `search.participants` shipped with
//    `identifierTypes.length > 0 ? inArray(...) : undefined`, which turns that
//    empty list into "every participant in the org, of every type". It is a
//    silent fail-open, so it needs a test or it will not announce itself.
// 2. The two halves cannot disagree. Filtering participants to `PHONE` while
//    reading `primary_email` off the contact record is a plausible-looking wrong
//    answer, and it is exactly what having two switches produced.

import { describe, expect, it } from 'vitest'
import {
  EMAIL_IDENTIFIER_FIELDS,
  identifierFieldsForModel,
  identifierTypesForModel,
  PHONE_IDENTIFIER_FIELDS,
  type RecipientModel,
} from '../channel-identifier-fields'

/** Every `recipientModel`. If `PlatformCapabilities` grows one, this array is
 *  the thing to extend — and the switches are exhaustive, so tsc will say so. */
const ALL_MODELS: RecipientModel[] = ['email', 'phone', 'thread_only', 'platform_user']

describe('identifierTypesForModel', () => {
  it('maps email and phone to their single type', () => {
    expect(identifierTypesForModel('email')).toEqual(['EMAIL'])
    expect(identifierTypesForModel('phone')).toEqual(['PHONE'])
  })

  it('accepts both PSID variants for thread_only', () => {
    expect(identifierTypesForModel('thread_only')).toEqual(['FACEBOOK_PSID', 'INSTAGRAM_IGSID'])
  })

  it('🔴 returns an EMPTY array for platform_user — which is "nothing addressable", not "no filter"', () => {
    expect(identifierTypesForModel('platform_user')).toEqual([])
  })

  it('never returns undefined, so a caller cannot confuse "no types" with "unfiltered"', () => {
    for (const model of ALL_MODELS) {
      expect(Array.isArray(identifierTypesForModel(model))).toBe(true)
    }
  })
})

describe('identifierFieldsForModel', () => {
  it('reads primary_email for email', () => {
    expect(identifierFieldsForModel('email')).toEqual({
      systemAttributes: ['primary_email'],
      identifierType: 'EMAIL',
    })
  })

  it('reads phone then primary_phone, in that preference order', () => {
    const fields = identifierFieldsForModel('phone')
    // Order is the contract: `phone` is what the contact registry seeds, and
    // `primary_phone` only exists on older / connector-provisioned orgs.
    expect(fields?.systemAttributes).toEqual(['phone', 'primary_phone'])
    expect(fields?.identifierType).toBe('PHONE')
  })

  it('returns undefined for the models no contact field can serve', () => {
    // Not a gap: no contact field holds a Facebook PSID or a platform user id,
    // so the caller must SKIP the contact arm rather than fall back to email.
    expect(identifierFieldsForModel('thread_only')).toBeUndefined()
    expect(identifierFieldsForModel('platform_user')).toBeUndefined()
  })
})

describe('the two halves agree', () => {
  it('every model with contact fields has that fields type among its participant types', () => {
    for (const model of ALL_MODELS) {
      const fields = identifierFieldsForModel(model)
      if (!fields) continue
      expect(identifierTypesForModel(model)).toContain(fields.identifierType)
    }
  })

  it('every model WITHOUT contact fields is either type-less or thread-scoped', () => {
    // The inverse direction: a model may legitimately have participant types but
    // no contact field (thread_only), but one with NO participant types must not
    // claim a contact field — that would offer an address nothing can send to.
    for (const model of ALL_MODELS) {
      if (identifierTypesForModel(model).length === 0) {
        expect(identifierFieldsForModel(model)).toBeUndefined()
      }
    }
  })

  it('the exported constants are the same objects both functions serve', () => {
    // Guards the drift this module exists to prevent: a future edit that changes
    // one switch arm without the other.
    expect(identifierFieldsForModel('email')).toBe(EMAIL_IDENTIFIER_FIELDS)
    expect(identifierFieldsForModel('phone')).toBe(PHONE_IDENTIFIER_FIELDS)
    expect(identifierTypesForModel('email')).toEqual([EMAIL_IDENTIFIER_FIELDS.identifierType])
    expect(identifierTypesForModel('phone')).toEqual([PHONE_IDENTIFIER_FIELDS.identifierType])
  })
})
