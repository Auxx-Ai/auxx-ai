// packages/lib/src/interactions/__tests__/identifiers.test.ts
//
// `toRecordIdentifiers` is the whole decision surface of the identifier read: which cells
// become claims, in which keyspace, and which collapse. Pure, so no doubles of any kind.

import type { IdentifierType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { emailIdentifiers, toRecordIdentifiers } from '../identifiers'

const EMAIL_FIELD = 'fld_email'
const PHONE_FIELD = 'fld_phone'
const LEGACY_PHONE_FIELD = 'fld_primary_phone'

const TYPES = new Map<string, IdentifierType>([
  [EMAIL_FIELD, 'EMAIL'],
  [PHONE_FIELD, 'PHONE'],
  [LEGACY_PHONE_FIELD, 'PHONE'],
])

describe('toRecordIdentifiers', () => {
  it('normalizes an email to the participant keyspace', () => {
    const out = toRecordIdentifiers(
      [{ entityId: 'c1', fieldId: EMAIL_FIELD, valueText: '  Sales@ACME.com ' }],
      TYPES
    )

    expect(out).toEqual([{ recordId: 'c1', identifier: 'sales@acme.com', identifierType: 'EMAIL' }])
  })

  it('keeps a leading + on a phone and strips the rest', () => {
    const out = toRecordIdentifiers(
      [{ entityId: 'c1', fieldId: PHONE_FIELD, valueText: '+1 (415) 555-1234' }],
      TYPES
    )

    expect(out[0]?.identifier).toBe('+14155551234')
    expect(out[0]?.identifierType).toBe('PHONE')
  })

  it('collapses one address held in two fields to a single claim', () => {
    // An org carrying both `phone` and the legacy `primary_phone` would otherwise produce
    // two claims for one participant row.
    const out = toRecordIdentifiers(
      [
        { entityId: 'c1', fieldId: PHONE_FIELD, valueText: '+14155551234' },
        { entityId: 'c1', fieldId: LEGACY_PHONE_FIELD, valueText: '+1-415-555-1234' },
      ],
      TYPES
    )

    expect(out).toHaveLength(1)
  })

  it('keeps the same address on two different contacts', () => {
    // Both are reported: this is the duplicate signal, and dropping one here would hide it.
    const out = toRecordIdentifiers(
      [
        { entityId: 'c1', fieldId: EMAIL_FIELD, valueText: 'sales@acme.com' },
        { entityId: 'c2', fieldId: EMAIL_FIELD, valueText: 'sales@acme.com' },
      ],
      TYPES
    )

    expect(out.map((i) => i.recordId)).toEqual(['c1', 'c2'])
  })

  it('keeps several addresses on one contact — multi-value fields are one row per value', () => {
    const out = toRecordIdentifiers(
      [
        { entityId: 'c1', fieldId: EMAIL_FIELD, valueText: 'sales@acme.com' },
        { entityId: 'c1', fieldId: EMAIL_FIELD, valueText: 'billing@acme.com' },
      ],
      TYPES
    )

    expect(out).toHaveLength(2)
  })

  it('drops cells with no value and fields of no identifier type', () => {
    const out = toRecordIdentifiers(
      [
        { entityId: 'c1', fieldId: EMAIL_FIELD, valueText: null },
        { entityId: 'c1', fieldId: EMAIL_FIELD, valueText: '   ' },
        { entityId: 'c1', fieldId: 'fld_notes', valueText: 'not an address' },
      ],
      TYPES
    )

    expect(out).toEqual([])
  })
})

describe('emailIdentifiers', () => {
  it('keeps only EMAIL rows — the ThreadParticipant table has no identifier type', () => {
    const all = toRecordIdentifiers(
      [
        { entityId: 'c1', fieldId: EMAIL_FIELD, valueText: 'sales@acme.com' },
        { entityId: 'c1', fieldId: PHONE_FIELD, valueText: '+14155551234' },
      ],
      TYPES
    )

    expect(emailIdentifiers(all)).toEqual([
      { recordId: 'c1', identifier: 'sales@acme.com', identifierType: 'EMAIL' },
    ])
  })
})
