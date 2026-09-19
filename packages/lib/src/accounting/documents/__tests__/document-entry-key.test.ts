// packages/lib/src/accounting/documents/__tests__/document-entry-key.test.ts
//
// The keyspace a repost lives in: the reversed original keeps its document
// number, so generation 2 onwards has to mint a different one that still leaves
// room for its own `-R<n>` suffix.

import { describe, expect, it } from 'vitest'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../../ledger/builders/doc-number'
import { documentEntryKey } from '../document-entry-key'

const BILL = { prefix: 'BGN', label: 'vendor bill repost' }

describe('documentEntryKey', () => {
  it('leaves the FIRST post keyed on the internal number', () => {
    expect(documentEntryKey('BILL-0002', 1, BILL)).toBeUndefined()
  })

  it('keys a repost on the number digits plus the generation marker', () => {
    expect(documentEntryKey('BILL-0002', 2, BILL)).toBe('0002G2')
    expect(documentEntryKey('BILL-0002', 3, BILL)).toBe('0002G3')
  })

  it('fits a six-digit internal number with its reversal suffix', () => {
    const key = documentEntryKey('BIL-123456', 2, BILL)
    expect(key).toBe('123456G2')
    expect(
      buildDocNumber({ postingType: 'vendor_bill', periodKey: key!, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('falls back to the family-prefixed hash when the number carries no digits', () => {
    const key = documentEntryKey('BILL', 2, BILL)
    expect(key).toMatch(/^BGN-[0-9a-z]{6}$/i)
    expect(
      buildDocNumber({ postingType: 'vendor_bill', periodKey: key!, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('falls back when the marker would not fit beside the digits', () => {
    expect(documentEntryKey('BILL-1234567890', 2, BILL)).toMatch(/^BGN-/)
  })
})
