// packages/lib/src/postings/__tests__/delivery-proof.test.ts
import { describe, expect, it } from 'vitest'
import { toNeutralPartyType } from '../../money/quickbooks/object-types'
import {
  preparedJournalSchema,
  quickbooksJournalWirePayload,
  verifyDeliveredJournal,
} from '../delivery-proof'

const prepared = {
  txnDate: '2026-09-15',
  docNumber: 'AUXX-FUL-test',
  privateNote: 'auxx:gl:fulfillment:fixture',
  requestId: 'request',
  currency: 'USD',
  lines: [
    {
      amountMinor: 4999,
      postingType: 'Debit',
      accountId: 'AR',
      entity: { type: 'Customer', id: 'C1' },
    },
    { amountMinor: 4999, postingType: 'Credit', accountId: 'REV' },
  ],
}
const remote = () => ({
  journalEntryId: '123',
  syncToken: '0',
  txnDate: prepared.txnDate,
  docNumber: prepared.docNumber,
  privateNote: prepared.privateNote,
  currency: 'USD',
  lines: prepared.lines.map((l) => ({
    amountMinor: l.amountMinor,
    postingType: l.postingType,
    accountId: l.accountId,
    entityType: l.entity?.type ?? null,
    entityId: l.entity?.id ?? null,
  })),
})
function verify(value: unknown) {
  return verifyDeliveredJournal({
    prepared,
    remote: value,
    intendedCompanyId: 'companyA',
    actualCompanyId: 'companyA',
    toNeutralParty: toNeutralPartyType,
  })
}
describe('complete journal delivery proof', () => {
  it('accepts equivalent lines in a different remote order', () => {
    const value = remote()
    value.lines.reverse()
    expect(verify(value).journalEntryId).toBe('123')
  })
  it.each([
    'txnDate',
    'docNumber',
    'currency',
    'privateNote',
  ] as const)('rejects a mismatched %s', (field) => {
    const value = remote()
    value[field] = 'different'
    expect(() => verify(value)).toThrow()
  })
  it.each([
    'accountId',
    'amountMinor',
    'entityId',
    'entityType',
  ] as const)('rejects mismatched line %s', (field) => {
    const value = remote()
    Object.assign(value.lines[0]!, { [field]: field === 'amountMinor' ? 5000 : 'different' })
    expect(() => verify(value)).toThrow()
  })
  it('rejects another company even for identical remote IDs and amounts', () => {
    expect(() =>
      verifyDeliveredJournal({
        prepared,
        remote: remote(),
        intendedCompanyId: 'A',
        actualCompanyId: 'B',
        toNeutralParty: toNeutralPartyType,
      })
    ).toThrow()
  })
  it('compares the party the adapter translated, not the raw provider spelling', () => {
    // D14b: the delivery tables speak a neutral vocabulary, so the readback
    // comparison runs on what the adapter's map returned. Two spellings the
    // adapter calls the same party compare equal; the real map does not, which
    // is why the same readback is refused under it.
    const value = remote()
    value.lines[0]!.entityType = 'Vendor'
    expect(() => verify(value)).toThrow()
    expect(() =>
      verifyDeliveredJournal({
        prepared,
        remote: value,
        intendedCompanyId: 'companyA',
        actualCompanyId: 'companyA',
        toNeutralParty: () => 'customer',
      })
    ).not.toThrow()
  })
  it('translates every known QuickBooks party spelling both ways', () => {
    expect(['Customer', 'Vendor', 'Employee'].map(toNeutralPartyType)).toEqual([
      'customer',
      'vendor',
      'employee',
    ])
    expect(() => toNeutralPartyType('Contact')).toThrow()
  })
  it('rejects incomplete ID-only readback', () => {
    expect(() => verify({ journalEntryId: '123' })).toThrow()
  })
  it('saves explicit currency and cents converted once in the exact wire body', () => {
    expect(quickbooksJournalWirePayload(prepared)).toMatchObject({
      CurrencyRef: { value: 'USD' },
      Line: [
        {
          Amount: 49.99,
          JournalEntryLineDetail: {
            AccountRef: { value: 'AR' },
            Entity: { Type: 'Customer', EntityRef: { value: 'C1' } },
          },
        },
        { Amount: 49.99 },
      ],
    })
  })
  it('refuses unsafe amounts', () => {
    expect(
      preparedJournalSchema.safeParse({
        ...prepared,
        lines: prepared.lines.map((l) => ({ ...l, amountMinor: Number.MAX_SAFE_INTEGER + 1 })),
      }).success
    ).toBe(false)
  })
})
