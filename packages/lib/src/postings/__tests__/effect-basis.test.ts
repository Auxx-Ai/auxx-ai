// packages/lib/src/postings/__tests__/effect-basis.test.ts
import { describe, expect, it } from 'vitest'
import {
  accountingBasisHash,
  canonicalAccountingJson,
  correctionAccountingEffectKey,
  fromLedgerMinor,
  fulfillmentAccountingEffectKey,
  toLedgerMinor,
} from '../effect-basis'
import { acceptedFulfillmentEffectBasisSchema, accountingWorkBasisSchema } from '../effect-types'
import { acceptedBasis, readyBasis } from './fixtures/accounting-effect-basis'

describe('durable accounting basis', () => {
  it('hashes equivalent object keys consistently and preserves ordered inputs', () => {
    expect(accountingBasisHash({ b: 2, a: ['a', 'b'] })).toBe(
      accountingBasisHash({ a: ['a', 'b'], b: 2 })
    )
    expect(accountingBasisHash(['a', 'b'])).not.toBe(accountingBasisHash(['b', 'a']))
    expect(() => canonicalAccountingJson({ lost: undefined })).toThrow()
    expect(() => canonicalAccountingJson({ amount: 2n })).toThrow()
  })
  it('keeps original identity independent of policies and unambiguously encodes correction components', () => {
    expect(fulfillmentAccountingEffectKey('f1')).toBe('fulfillment_accounting:["f1","original"]')
    expect(correctionAccountingEffectKey('a:b', 'c', 'd')).not.toBe(
      correctionAccountingEffectKey('a', 'b:c', 'd')
    )
  })
  it('refuses fractional, unsafe and unsupported-currency money before conversion', () => {
    expect(toLedgerMinor('9007199254740991', 'USD', 2)).toBe(Number.MAX_SAFE_INTEGER)
    for (const value of ['9007199254740992', '1.2', '-1', '01'])
      expect(() => toLedgerMinor(value, 'USD', 2)).toThrow()
    expect(() => toLedgerMinor('100', 'EUR', 2)).toThrow()
    expect(() => fromLedgerMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(() => fromLedgerMinor(1.1)).toThrow()
  })
  it('requires complete ready input while retaining incomplete evidence explicitly', () => {
    expect(accountingWorkBasisSchema.parse(readyBasis('f1')).status).toBe('ready')
    expect(
      accountingWorkBasisSchema.safeParse({ ...readyBasis('f1'), calculation: {} }).success
    ).toBe(false)
    expect(
      acceptedFulfillmentEffectBasisSchema.safeParse({
        ...acceptedBasis('f1'),
        calculation: { status: 'incomplete' },
      }).success
    ).toBe(false)
    expect(
      accountingWorkBasisSchema.safeParse({ ...readyBasis('f1'), fulfillmentInstanceId: 'f2' })
        .success
    ).toBe(false)
  })
  it('validates independent balance, exact account resolution and party attribution', () => {
    const basis = acceptedBasis('f1')
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(basis).success).toBe(true)
    const invalid = structuredClone(basis)
    invalid.contribution[0]!.amountMinor = '101'
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(invalid).success).toBe(false)
    const wrongAccount = structuredClone(basis)
    wrongAccount.accountResolution[0]!.glAccountId = 'other'
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(wrongAccount).success).toBe(false)
    const missingParty = structuredClone(basis)
    missingParty.contribution[0]!.counterpartyType = 'customer'
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(missingParty).success).toBe(false)
  })

  it.each([
    '1.5',
    'NaN',
    '',
    '01',
    '-1',
    '0',
  ])('returns a validation failure for malformed contribution %j', (amount) => {
    const basis = acceptedBasis('f1')
    basis.contribution[0]!.amountMinor = amount
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(basis).success).toBe(false)
  })

  it('refuses a balanced effect whose combined total exceeds the ledger boundary', () => {
    const basis = acceptedBasis('f1')
    basis.contribution = [
      ...basis.contribution,
      ...basis.contribution.map((line) => ({ ...line, lineKey: line.lineKey + '_extra' })),
    ]
    basis.accountResolution = [
      ...basis.accountResolution,
      ...basis.accountResolution.map((line) => ({ ...line, lineKey: line.lineKey + '_extra' })),
    ]
    for (const line of basis.contribution) line.amountMinor = '4503599627370496'
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(basis).success).toBe(false)
  })

  it('rejects duplicate members, unrelated document references and source-hash mismatches', () => {
    const duplicate = acceptedBasis('f1')
    duplicate.contribution[1]!.lineKey = duplicate.contribution[0]!.lineKey
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(duplicate).success).toBe(false)
    const wrongSource = acceptedBasis('f1')
    wrongSource.documentRefs[0]!.entityInstanceId = 'another_fulfillment'
    expect(acceptedFulfillmentEffectBasisSchema.safeParse(wrongSource).success).toBe(false)
    const wrongHash = readyBasis('f1')
    wrongHash.calculation.sourceHash = 'b'.repeat(64)
    expect(accountingWorkBasisSchema.safeParse(wrongHash).success).toBe(false)
  })

  it('retains named incomplete evidence but rejects impossible ready dates', () => {
    const basis = readyBasis('f1')
    expect(
      accountingWorkBasisSchema.safeParse({
        version: 1,
        status: 'incomplete',
        fulfillmentInstanceId: 'f1',
        sourceHash: basis.sourceHash,
        effectiveDate: null,
        missingDependencies: ['order_lines'],
        observed: { sourceId: 'external_f1' },
      }).success
    ).toBe(true)
    expect(
      accountingWorkBasisSchema.safeParse({ ...basis, effectiveDate: '2026-02-30' }).success
    ).toBe(false)
  })
})
