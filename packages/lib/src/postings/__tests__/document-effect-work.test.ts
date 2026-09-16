// packages/lib/src/postings/__tests__/document-effect-work.test.ts
//
// The identity half of the document contract, and in particular the OCCURRENCE
// that D19's one repeatable family needs (53 §7.3.3, task A).
//
// 🛑 The pair of properties below is what replaces the partial unique index for
// `invoice_write_off`. `AccountingWork_fulfillment_original_key` is narrowed to
// the 1:1 families, so `AccountingWork_org_effect_key` is the ONLY thing left
// stopping two write-offs of one invoice from becoming one obligation - and the
// only thing stopping a 1:1 family from quietly minting a second original.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { DOCUMENT_EFFECT_FAMILY_SPEC } from '../document-effect-types'
import { documentAccountingEffectKey } from '../document-effect-work'

describe('documentAccountingEffectKey', () => {
  it('is unchanged for a family with no occurrence', () => {
    expect(documentAccountingEffectKey('invoice_issued', 'inv_1')).toBe(
      'invoice_issued:["inv_1","original"]'
    )
  })

  it('gives each write-off of one invoice its own identity', () => {
    const first = documentAccountingEffectKey('invoice_write_off', 'inv_1', 'original')
    const second = documentAccountingEffectKey('invoice_write_off', 'inv_1', 'attempt:1')
    const third = documentAccountingEffectKey('invoice_write_off', 'inv_1', 'attempt:2')
    expect(new Set([first, second, third]).size).toBe(3)
  })

  // 🔑 The first write-off must key exactly as it would if the family were 1:1,
  // so an invoice written off once has the same identity every other D19 family
  // has, and so nothing already in a ledger is re-keyed.
  it('leaves the FIRST write-off byte-for-byte the 1:1 key', () => {
    expect(documentAccountingEffectKey('invoice_write_off', 'inv_1')).toBe(
      'invoice_write_off:["inv_1","original"]'
    )
    expect(documentAccountingEffectKey('invoice_write_off', 'inv_1', 'original')).toBe(
      documentAccountingEffectKey('invoice_write_off', 'inv_1')
    )
  })

  it('refuses an occurrence from a family that is one obligation per document', () => {
    expect(() => documentAccountingEffectKey('invoice_issued', 'inv_1', 'attempt:1')).toThrow(
      UnprocessableEntityError
    )
    expect(() => documentAccountingEffectKey('payout_settlement', 'po_1', 'attempt:1')).toThrow(
      /one accounting obligation per document/
    )
  })

  it('refuses a blank document or occurrence', () => {
    expect(() => documentAccountingEffectKey('invoice_issued', '')).toThrow(
      UnprocessableEntityError
    )
    expect(() => documentAccountingEffectKey('invoice_write_off', 'inv_1', '')).toThrow(
      UnprocessableEntityError
    )
  })
})

describe('DOCUMENT_EFFECT_FAMILY_SPEC.repeatable', () => {
  // 🛑 An exact set, not a spot check: a seventh family copied from an existing
  // one must declare which side of this line it is on, because the answer
  // decides whether the narrowed partial unique index covers it.
  it('names exactly the one family that is not 1:1 with its document', () => {
    const repeatable = Object.entries(DOCUMENT_EFFECT_FAMILY_SPEC)
      .filter(([, spec]) => spec.repeatable)
      .map(([family]) => family)
    expect(repeatable).toEqual(['invoice_write_off'])
  })
})
