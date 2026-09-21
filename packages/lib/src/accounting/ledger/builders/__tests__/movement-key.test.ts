// packages/lib/src/accounting/ledger/builders/__tests__/movement-key.test.ts

import { describe, expect, it } from 'vitest'
import { AuxxError } from '../../../../errors'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../doc-number'
import { movementPeriodKey } from '../movement-key'

describe('movementPeriodKey', () => {
  // The defect this replaces: the key was the book date, so two payments
  // settling on one day minted ONE document number and the second lost
  // `GlPosting_org_docNumber_key` at approval.
  it('gives two movements on one day two document numbers', () => {
    const one = movementPeriodKey('payment', 'jselwbktodj6z813xmw4fmiv')
    const two = movementPeriodKey('payment', 'g55lpt1b4o27wupwiklex1a5')

    expect(one).not.toBe(two)
    expect(buildDocNumber({ postingType: 'payment', periodKey: one })).not.toBe(
      buildDocNumber({ postingType: 'payment', periodKey: two })
    )
  })

  it('survives a reversal inside the document-number cap', () => {
    const key = movementPeriodKey('refund', 'jselwbktodj6z813xmw4fmiv')

    expect(buildDocNumber({ postingType: 'refund', periodKey: key, revision: 1 })).toBe(`${key}-R1`)
    expect(`${key}-R9`.length).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('separates a payment from a refund of the same movement', () => {
    expect(movementPeriodKey('payment', 'mt_1')).not.toBe(movementPeriodKey('refund', 'mt_1'))
  })

  it('refuses a blank movement id', () => {
    expect(() => movementPeriodKey('payment', '  ')).toThrow(AuxxError)
  })
})
