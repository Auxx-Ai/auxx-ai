// packages/lib/src/postings/__tests__/build-write-off-entry.test.ts

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  type BuildWriteOffEntryInput,
  buildWriteOffEntry,
  MAX_WRITE_OFF_ATTEMPT,
  WRITE_OFF_SOURCE_TYPE,
  writeOffPeriodKey,
} from '../build-write-off-entry'
import { buildDocNumber } from '../doc-number'

const BASE: BuildWriteOffEntryInput = {
  invoiceId: 'inv_abc',
  invoiceNumber: 'INV-0042',
  amountMinor: 12_345,
  txnDate: '2026-09-03',
}

function expectRefusal(fn: () => unknown): UnprocessableEntityError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    return error as UnprocessableEntityError
  }
  throw new Error('Expected a refusal, got a built entry')
}

describe('buildWriteOffEntry - the happy path', () => {
  const built = buildWriteOffEntry(BASE)

  it('balances by construction', () => {
    expect(built.totalDebit).toBe(12_345)
    expect(built.totalCredit).toBe(12_345)
  })

  it('is the write_off posting type', () => {
    expect(built.postingType).toBe('write_off')
  })

  // The invoice's own number, not a date and not a cuid - `doc-number.ts` keys
  // write_off on the record's own number the same way manual_journal/bank_deposit
  // do, because a cuid blows the 21-character document-number cap.
  it('keys periodKey on the invoice number, and txnDate on the accounting date', () => {
    expect(built.periodKey).toBe('INV-0042')
    expect(built.txnDate).toBe('2026-09-03')
  })

  it('debits bad_debt_expense and credits accounts_receivable, both by ROLE', () => {
    const [debit, credit] = built.lines
    expect(debit).toMatchObject({
      accountRole: ACCOUNT_ROLES.BAD_DEBT_EXPENSE,
      direction: 'debit',
      amount: 12_345,
    })
    expect(debit?.accountCode).toBeUndefined()
    expect(credit).toMatchObject({
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'credit',
      amount: 12_345,
    })
    expect(credit?.accountCode).toBeUndefined()
  })

  it('carries the invoice as sourceType/sourceId on every line', () => {
    for (const line of built.lines) {
      expect(line.sourceType).toBe(WRITE_OFF_SOURCE_TYPE)
      expect(line.sourceId).toBe('inv_abc')
    }
    expect(WRITE_OFF_SOURCE_TYPE).toBe('invoice')
  })

  it('defaults the memo to naming the invoice', () => {
    expect(built.lines[0]?.memo).toBe('Write off INV-0042')
  })

  it('honours an explicit memo on both lines', () => {
    const withMemo = buildWriteOffEntry({ ...BASE, memo: 'Customer bankrupt' })
    expect(withMemo.lines.every((l) => l.memo === 'Customer bankrupt')).toBe(true)
  })
})

describe('buildWriteOffEntry - the expenseAccountCode override', () => {
  it('names a CODE on the debit leg instead of the bad_debt_expense role', () => {
    const built = buildWriteOffEntry({ ...BASE, expenseAccountCode: '6301' })
    const [debit, credit] = built.lines
    expect(debit).toMatchObject({ accountCode: '6301', direction: 'debit', amount: 12_345 })
    expect(debit?.accountRole).toBeUndefined()
    // The credit leg is NEVER overridable - accounts_receivable is the one
    // receivable role (handoff decision 6.1), always by role.
    expect(credit).toMatchObject({ accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE })
  })
})

describe('buildWriteOffEntry - refusals', () => {
  it('refuses a blank invoice number', () => {
    const error = expectRefusal(() => buildWriteOffEntry({ ...BASE, invoiceNumber: '' }))
    expect(error.message).toMatch(/invoice's own number/)
  })

  it('refuses a non-integer amount', () => {
    expectRefusal(() => buildWriteOffEntry({ ...BASE, amountMinor: 12.5 }))
  })

  it('refuses a zero amount', () => {
    expectRefusal(() => buildWriteOffEntry({ ...BASE, amountMinor: 0 }))
  })

  it('refuses a negative amount', () => {
    expectRefusal(() => buildWriteOffEntry({ ...BASE, amountMinor: -100 }))
  })
})

describe('the document-number keyspace', () => {
  it('accepts an invoice number that still leaves room for a reversal suffix', () => {
    // `AUXX-WOF-` (9) + 9 compacted characters + `-R1` (3) = 21, the cap.
    const entry = buildWriteOffEntry({
      invoiceId: 'inv_1',
      invoiceNumber: 'INV-123456',
      amountMinor: 20_000,
      txnDate: '2026-09-04',
    })
    expect(buildDocNumber({ postingType: 'write_off', periodKey: entry.periodKey })).toBe(
      'AUXX-WOF-INV123456'
    )
    expect(
      buildDocNumber({ postingType: 'write_off', periodKey: entry.periodKey, revision: 1 })
    ).toBe('AUXX-WOF-INV123456-R1')
  })

  it('refuses at BUILD time an invoice number that would only fail at reversal', () => {
    // 🛑 Twelve compacted characters posts fine (`AUXX-WOF-` + 12 = 21) and then
    // refuses at 24 when `-R1` is added - a write-off in the books that cannot
    // be reversed. The refusal has to happen before anything is claimed.
    const tooLong = {
      invoiceId: 'inv_1',
      invoiceNumber: 'INV-202609-004',
      amountMinor: 20_000,
      txnDate: '2026-09-04',
    }
    expect(() => buildWriteOffEntry(tooLong)).toThrowError(UnprocessableEntityError)
    expect(() => buildWriteOffEntry(tooLong)).toThrowError(/compacts to 12 characters/)

    // And the thing it is protecting against really is a reversal-only failure:
    // revision 0 on that key composes to exactly the cap, so the entry WOULD
    // have posted; only the reversal blows it.
    expect(buildDocNumber({ postingType: 'write_off', periodKey: 'INV-202609-004' })).toHaveLength(
      21
    )
    expect(() =>
      buildDocNumber({ postingType: 'write_off', periodKey: 'INV-202609-004', revision: 1 })
    ).toThrowError(/over the 21-character cap/)
  })
})

// 🛑 The defect this block exists for: `periodKey` was the invoice number and
// nothing else, so a SECOND partial write-off claimed the same
// `(organizationId, write_off, periodKey, revision = 0)` tuple, `postEntry`
// answered `already_posted` - a SUCCESS - and nothing posted. The books were
// short by the second write-off and the caller reported success.
describe('writeOffPeriodKey - the attempt counter', () => {
  it('is the invoice number verbatim at attempt 0, so nothing already in a ledger is re-keyed', () => {
    expect(writeOffPeriodKey({ invoiceNumber: 'INV-0042' })).toBe('INV-0042')
    expect(writeOffPeriodKey({ invoiceNumber: 'INV-0042', attempt: 0 })).toBe('INV-0042')
    expect(buildWriteOffEntry(BASE).periodKey).toBe('INV-0042')
  })

  it('mints a DISTINCT key for every attempt', () => {
    const keys = [0, 1, 2, 35].map((attempt) =>
      writeOffPeriodKey({ invoiceNumber: 'INV-0042', attempt })
    )
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[1]).toBe('INV-00421')
    expect(keys[3]).toBe('INV-0042Z')
  })

  it('keeps every attempt inside the document-number cap, reversal included', () => {
    for (let attempt = 0; attempt <= MAX_WRITE_OFF_ATTEMPT; attempt++) {
      const periodKey = writeOffPeriodKey({ invoiceNumber: 'INV-0042', attempt })
      expect(
        buildDocNumber({ postingType: 'write_off', periodKey, revision: 9 }).length
      ).toBeLessThanOrEqual(21)
    }
  })

  it('folds an invoice number with no room left for the attempt character', () => {
    // Nine compacted characters is the whole budget, so a retry cannot append.
    const key = writeOffPeriodKey({ invoiceNumber: 'INV-123456', attempt: 1 })
    expect(key).toHaveLength(9)
    expect(key.endsWith('1')).toBe(true)
    expect(buildDocNumber({ postingType: 'write_off', periodKey: key, revision: 9 })).toHaveLength(
      21
    )
  })

  it('refuses past the keyspace, naming the manual-journal remedy', () => {
    const error = expectRefusal(() =>
      writeOffPeriodKey({ invoiceNumber: 'INV-0042', attempt: MAX_WRITE_OFF_ATTEMPT + 1 })
    )
    expect(error.message).toMatch(/manual journal entry/)
    expect(error.message).toMatch(/INV-0042/)
  })

  it('refuses a fractional or negative attempt', () => {
    expectRefusal(() => writeOffPeriodKey({ invoiceNumber: 'INV-0042', attempt: 1.5 }))
    expectRefusal(() => writeOffPeriodKey({ invoiceNumber: 'INV-0042', attempt: -1 }))
  })

  it('carries the attempt through buildWriteOffEntry', () => {
    expect(buildWriteOffEntry({ ...BASE, attempt: 1 }).periodKey).toBe('INV-00421')
    expect(buildWriteOffEntry({ ...BASE, attempt: 2 }).periodKey).toBe('INV-00422')
  })
})
