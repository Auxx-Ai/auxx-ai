// packages/lib/src/accounting/money/customer-money/__tests__/evidence-contracts.test.ts
import { describe, expect, it } from 'vitest'
import {
  assessPayoutMembership,
  exactEvidenceMinor,
  type PayoutEvidenceEnvelope,
  payoutEvidenceEnvelopeSchema,
} from '../evidence-contracts'

function payout(): PayoutEvidenceEnvelope {
  return {
    version: 1,
    sourceAccount: {
      externalAccountId: 'merchant-1',
      environment: 'live',
    },
    payout: {
      id: 'p1',
      status: 'paid',
      amount: '97.00',
      currency: 'USD',
      currencyExponent: 2,
      issuedAt: null,
      issuedOn: '2026-09-15',
      destinationExternalId: null,
      raw: {},
    },
    membership: {
      complete: true,
      providerReady: true,
      reason: null,
      entries: [
        {
          id: 'b1',
          type: 'charge',
          gross: '100.00',
          fee: '3.00',
          net: '97.00',
          currency: 'USD',
          currencyExponent: 2,
          transactionDate: '2026-09-15T12:00:00Z',
          payoutId: 'p1',
          sourceTransactionId: 'tx1',
          sourceOrderId: 'o1',
          sourceId: 'ch1',
          sourceType: 'charge',
          raw: {},
        },
      ],
    },
  }
}
describe('exact payout evidence contracts', () => {
  it('preserves signed and zero values beyond safe JavaScript integers', () => {
    expect(exactEvidenceMinor('9007199254740993.01', 'USD', 2)).toBe(900719925474099301n)
    expect(exactEvidenceMinor('-3.00', 'USD', 2)).toBe(-300n)
    expect(exactEvidenceMinor('0.00', 'USD', 2)).toBe(0n)
  })
  it('rejects incorrect exponents, fractional loss and PostgreSQL bigint overflow', () => {
    expect(() => exactEvidenceMinor('1', 'JPY', 2)).toThrow('Currency exponent')
    expect(() => exactEvidenceMinor('1.001', 'USD', 2)).toThrow('precision')
    expect(() => exactEvidenceMinor('92233720368547758.08', 'USD', 2)).toThrow('capacity')
  })
  it('reconciles the independent header and excludes outgoing transfer evidence', () => {
    const input = payout()
    input.membership.entries.push({
      ...input.membership.entries[0]!,
      id: 'out',
      type: 'outgoing_transfer',
      gross: '-97.00',
      fee: '0',
      net: '-97.00',
    })
    expect(assessPayoutMembership(input)).toMatchObject({
      state: 'complete',
      constituentNetMinor: 9700n,
      differenceMinor: 0n,
    })
    input.payout.amount = '96.00'
    expect(assessPayoutMembership(input).differenceMinor).toBe(-100n)
  })
  it('does not treat incomplete empty membership as complete', () => {
    const input = payout()
    input.membership.entries = []
    input.membership.complete = false
    expect(assessPayoutMembership(input).state).toBe('incomplete')
  })
  it.each([
    'returned_transfer',
    'unknown',
  ] as const)('retains %s activity without counting it as ordinary payout membership', (type) => {
    const input = payout()
    input.membership.entries.push({ ...input.membership.entries[0]!, id: 'other', type })
    expect(assessPayoutMembership(input)).toMatchObject({
      state: 'unsupported',
      constituentNetMinor: null,
      differenceMinor: null,
    })
  })
  it('requires adapters to translate provider activity names into shared meanings', () => {
    const input = payout()
    const raw = {
      ...input,
      membership: {
        ...input.membership,
        entries: [{ ...input.membership.entries[0], type: 'provider_payout_completed' }],
      },
    }
    expect(payoutEvidenceEnvelopeSchema.safeParse(raw).success).toBe(false)
  })
  it('keeps readiness separate from page completion', () => {
    const input = payout()
    input.membership.providerReady = false
    expect(assessPayoutMembership(input).state).toBe('complete')
  })
  it('detects duplicate and wrong-payout membership', () => {
    const input = payout()
    input.membership.entries.push({ ...input.membership.entries[0]! })
    expect(assessPayoutMembership(input).state).toBe('incomplete')
    input.membership.entries = [{ ...input.membership.entries[0]!, payoutId: null }]
    expect(assessPayoutMembership(input).state).toBe('incomplete')
  })
  it('retains foreign currency evidence with unsupported reconciliation', () => {
    const input = payout()
    input.membership.entries[0]!.currency = 'EUR'
    expect(assessPayoutMembership(input)).toMatchObject({
      state: 'unsupported',
      constituentNetMinor: null,
      differenceMinor: null,
    })
  })
  it('validates actual calendar dates and preserves date-only precision', () => {
    const input = payout()
    expect(payoutEvidenceEnvelopeSchema.parse(input).payout.issuedOn).toBe('2026-09-15')
    input.payout.issuedOn = '2026-02-30'
    expect(payoutEvidenceEnvelopeSchema.safeParse(input).success).toBe(false)
  })
})
