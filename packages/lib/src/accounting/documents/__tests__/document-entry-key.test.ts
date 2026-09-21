// packages/lib/src/accounting/documents/__tests__/document-entry-key.test.ts

import { describe, expect, it } from 'vitest'
import { buildDocNumber } from '../../ledger/builders/doc-number'
import { documentEntryKey } from '../document-entry-key'

describe('documentEntryKey', () => {
  it('leaves the FIRST post keyed on the internal number', () => {
    expect(documentEntryKey('BILL-0002', 1)).toBeUndefined()
  })

  it('keys a repost on the number plus the generation marker', () => {
    expect(documentEntryKey('BILL-0002', 2)).toBe('BILL-0002-G2')
    expect(documentEntryKey('BILL-0002', 3)).toBe('BILL-0002-G3')
  })

  it('is the document number verbatim, with room for its own reversal', () => {
    const key = documentEntryKey('BILL-0000000123', 2)
    expect(buildDocNumber({ postingType: 'vendor_bill', periodKey: key!, revision: 1 })).toBe(
      'BILL-0000000123-G2-R1'
    )
  })
})
