// packages/lib/src/accounting/ledger/builders/__tests__/doc-number.test.ts
//
// The document number is a deterministic NATURAL KEY: `GlPosting_org_docNumber_key`
// is unique per org, and the QuickBooks adapter's layer-2 heal queries by it.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../../errors'
import { POSTING_TYPES } from '../../types'
import {
  buildDocNumber,
  DOC_NUMBER_KIND,
  DOC_NUMBER_MAX_LENGTH,
  DOC_NUMBER_PREFIX,
  DOCUMENT_KEY_MAX_LENGTH,
} from '../doc-number'

describe('the prefix and kind tables cover the vocabulary', () => {
  // Exact-key equality, both directions: only this catches a REMOVAL.
  it('declares a prefix for exactly the posting types that exist', () => {
    expect(Object.keys(DOC_NUMBER_PREFIX).sort()).toEqual([...POSTING_TYPES].sort())
  })

  it('declares a kind for exactly the posting types that exist', () => {
    expect(Object.keys(DOC_NUMBER_KIND).sort()).toEqual([...POSTING_TYPES].sort())
  })

  it('gives every type a DISTINCT three-letter prefix', () => {
    const prefixes = Object.values(DOC_NUMBER_PREFIX)
    expect(new Set(prefixes).size).toBe(prefixes.length)
    for (const prefix of prefixes) expect(prefix).toMatch(/^[A-Z]{3}$/)
  })

  it('reserves a repost and a reversal suffix in the document budget', () => {
    expect(DOCUMENT_KEY_MAX_LENGTH).toBe(15)
  })
})

describe('the three kinds', () => {
  it('a document-keyed type carries its record number verbatim', () => {
    expect(buildDocNumber({ postingType: 'vendor_bill', periodKey: 'BILL-000123' })).toBe(
      'BILL-000123'
    )
    expect(buildDocNumber({ postingType: 'manual_journal', periodKey: 'JNL-0007' })).toBe(
      'JNL-0007'
    )
    expect(buildDocNumber({ postingType: 'fulfillment', periodKey: 'ORD-0012-F1' })).toBe(
      'ORD-0012-F1'
    )
  })

  it('a hash-keyed type carries its prefixed hash verbatim', () => {
    expect(buildDocNumber({ postingType: 'payment', periodKey: 'PMT-80DBIZ' })).toBe('PMT-80DBIZ')
  })

  it('a calendar-keyed type composes the prefix with the compacted key', () => {
    expect(buildDocNumber({ postingType: 'month_end_deferral', periodKey: '2027-03' })).toBe(
      'DEF-202703'
    )
    expect(buildDocNumber({ postingType: 'opening_balance', periodKey: '2026-01-01' })).toBe(
      'OPB-20260101'
    )
    expect(buildDocNumber({ postingType: 'provider_sync', periodKey: '139' })).toBe('SYN-139')
  })

  it('is deterministic — the same identity always yields the same string', () => {
    const once = buildDocNumber({ postingType: 'fulfillment', periodKey: 'ORD-0012-F1' })
    expect(buildDocNumber({ postingType: 'fulfillment', periodKey: 'ORD-0012-F1' })).toBe(once)
  })

  it('separates the calendar types — two entries on one day must not collide', () => {
    const calendar = POSTING_TYPES.filter((type) => DOC_NUMBER_KIND[type] === 'calendar')
    const seen = new Set(
      calendar.map((postingType) => buildDocNumber({ postingType, periodKey: '2026-08-18' }))
    )
    expect(seen.size).toBe(calendar.length)
  })
})

describe('the reversal suffix', () => {
  // Required, not cosmetic: a reversal sharing its original's number cannot be written.
  it('distinguishes a reversal from the entry it reverses', () => {
    const original = buildDocNumber({ postingType: 'vendor_bill', periodKey: 'BILL-0002' })
    const reversal = buildDocNumber({
      postingType: 'vendor_bill',
      periodKey: 'BILL-0002',
      revision: 1,
    })
    expect(original).toBe('BILL-0002')
    expect(reversal).toBe('BILL-0002-R1')
  })

  it('distinguishes successive revisions from each other', () => {
    const keys = [0, 1, 2, 3].map((revision) =>
      buildDocNumber({ postingType: 'month_end_deferral', periodKey: '2026-08', revision })
    )
    expect(new Set(keys).size).toBe(4)
  })

  it('adds NOTHING at revision 0', () => {
    expect(
      buildDocNumber({ postingType: 'month_end_deferral', periodKey: '2026-08', revision: 0 })
    ).toBe(buildDocNumber({ postingType: 'month_end_deferral', periodKey: '2026-08' }))
  })

  it.each([-1, 1.5, Number.NaN])('refuses a revision of %s', (revision) => {
    expect(() =>
      buildDocNumber({ postingType: 'manual_journal', periodKey: 'JNL-0007', revision })
    ).toThrow(UnprocessableEntityError)
  })
})

describe('the document budget', () => {
  const fifteen = 'BILL-0000000123'
  const sixteen = 'BILL-00000001234'

  it('posts a 15-character number, reverses it at -R1 and reposts it at -G2', () => {
    expect(fifteen).toHaveLength(15)
    expect(buildDocNumber({ postingType: 'vendor_bill', periodKey: fifteen })).toBe(fifteen)
    expect(buildDocNumber({ postingType: 'vendor_bill', periodKey: fifteen, revision: 1 })).toBe(
      `${fifteen}-R1`
    )
    const repost = `${fifteen}-G2`
    expect(buildDocNumber({ postingType: 'vendor_bill', periodKey: repost })).toBe(repost)
    expect(buildDocNumber({ postingType: 'vendor_bill', periodKey: repost, revision: 1 })).toBe(
      `${repost}-R1`
    )
  })

  // Checked at revision 0, not on the final string: a key that fits at revision
  // 0 and refuses at -R1 is an entry that cannot be taken out of the books.
  it('refuses a 16-character number at generation 1, naming the budget', () => {
    let message = ''
    try {
      buildDocNumber({ postingType: 'vendor_bill', periodKey: sixteen })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain(String(DOCUMENT_KEY_MAX_LENGTH))
    expect(message).toContain('reversal')
  })

  it('lets the date-in-prefix and six-digit numbers of 73-15 post', () => {
    expect(buildDocNumber({ postingType: 'invoice_issued', periodKey: 'INV-2609-0001' })).toBe(
      'INV-2609-0001'
    )
    expect(buildDocNumber({ postingType: 'vendor_bill', periodKey: 'BILL-100000' })).toBe(
      'BILL-100000'
    )
  })

  it('REFUSES a cuid rather than truncating it into a collision', () => {
    expect(() =>
      buildDocNumber({ postingType: 'manual_journal', periodKey: 'clx8k2p9q0000abcd1234efgh' })
    ).toThrow(UnprocessableEntityError)
  })

  it('still refuses the final string over 21 as the backstop', () => {
    expect(() =>
      buildDocNumber({ postingType: 'provider_sync', periodKey: '9'.repeat(15), revision: 1 })
    ).toThrow(UnprocessableEntityError)
    expect(
      buildDocNumber({ postingType: 'provider_sync', periodKey: '9'.repeat(11), revision: 9 })
        .length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })
})

describe('refusals', () => {
  it('refuses a blank period key', () => {
    expect(() => buildDocNumber({ postingType: 'inventory_movement', periodKey: '' })).toThrow(
      UnprocessableEntityError
    )
    expect(() => buildDocNumber({ postingType: 'inventory_movement', periodKey: '  ' })).toThrow(
      UnprocessableEntityError
    )
  })

  it('refuses an undeclared posting type rather than minting undefined-', () => {
    expect(() =>
      // @ts-expect-error — deliberately outside the closed vocabulary
      buildDocNumber({ postingType: 'invented', periodKey: '2026-08' })
    ).toThrow(UnprocessableEntityError)
  })
})
