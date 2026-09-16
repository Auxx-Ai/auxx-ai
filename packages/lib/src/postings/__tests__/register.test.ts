// packages/lib/src/postings/__tests__/register.test.ts
import { describe, expect, it } from 'vitest'
import {
  type PostingRegister,
  projectRegisterEntry,
  type RegisterAccountLabel,
  type RegisterEffectRow,
  registerTiesToPosting,
  registerTotalMinor,
} from '../register'
import { acceptedBasis } from './fixtures/accounting-effect-basis'

function row(overrides: Partial<RegisterEffectRow> = {}): RegisterEffectRow {
  return {
    effectId: 'effect1',
    workId: 'work1',
    effectKind: 'fulfillment_accounting',
    effectKey: 'fulfillment:ship1',
    operation: 'original',
    componentKey: 'original',
    basisVersion: 1,
    basisHash: 'b'.repeat(64),
    effectiveDate: '2026-09-14',
    currency: 'USD',
    acceptedBasis: acceptedBasis('ship1'),
    ...overrides,
  }
}

const labels = new Map<string, RegisterAccountLabel>([
  ['clearing', { accountCode: '1210', accountName: 'Card Clearing' }],
  ['revenue', { accountCode: '4000', accountName: 'Product Revenue' }],
])

function register(entries: PostingRegister['entries'], postingTotalMinor: number): PostingRegister {
  return {
    glPostingId: 'posting1',
    currency: 'USD',
    postingTotalMinor,
    entries,
    totalMinor: registerTotalMinor(entries),
  }
}

describe('projectRegisterEntry', () => {
  it('projects a stored contribution into register lines', () => {
    const entry = projectRegisterEntry(row(), labels)

    expect(entry.unreadable).toBe(false)
    expect(entry.policyKey).toBe('fulfillment_current_v1')
    expect(entry.totalMinor).toBe(100)
    expect(entry.lines).toHaveLength(2)
    expect(entry.lines[0]).toMatchObject({
      lineKey: 'clearing',
      glAccountId: 'clearing',
      direction: 'debit',
      amountMinor: 100,
      selectedBy: 'org_role',
    })
    expect(entry.documentRefs).toEqual([
      { resourceKind: 'fulfillment', entityInstanceId: 'ship1' },
      { resourceKind: 'order', entityInstanceId: 'order' },
    ])
  })

  it('borrows the account snapshot from the summary rather than the live chart', () => {
    const entry = projectRegisterEntry(row(), labels)

    expect(entry.lines.map((line) => line.accountName)).toEqual([
      'Card Clearing',
      'Product Revenue',
    ])
  })

  it('leaves an unmatched account unlabelled instead of inventing a name', () => {
    const entry = projectRegisterEntry(row(), new Map())

    expect(entry.unreadable).toBe(false)
    expect(entry.lines.every((line) => line.accountCode === null)).toBe(true)
    expect(entry.lines.every((line) => line.accountName === null)).toBe(true)
  })

  it('totals debits only, so the total is the entry amount and not twice it', () => {
    expect(projectRegisterEntry(row(), labels).totalMinor).toBe(100)
  })

  it('reads a family it has never heard of, because D19 adds seven more', () => {
    const entry = projectRegisterEntry(
      row({
        effectKind: 'vendor_bill_accounting',
        acceptedBasis: {
          ...acceptedBasis('ship1'),
          policyKey: 'some_future_policy_v3',
          documentRefs: [{ resourceKind: 'vendor_bill', entityInstanceId: 'bill1' }],
        },
      }),
      labels
    )

    expect(entry.unreadable).toBe(false)
    expect(entry.effectKind).toBe('vendor_bill_accounting')
    expect(entry.policyKey).toBe('some_future_policy_v3')
    expect(entry.documentRefs).toEqual([{ resourceKind: 'vendor_bill', entityInstanceId: 'bill1' }])
  })

  it("surfaces D13's reserved basis dimension when a row ever carries one", () => {
    const accrual = projectRegisterEntry(
      row({ acceptedBasis: { ...acceptedBasis('ship1'), basis: 'accrual' } }),
      labels
    )

    expect(accrual.basis).toBe('accrual')
    expect(projectRegisterEntry(row(), labels).basis).toBeNull()
  })

  it('reports a basis it cannot read rather than showing it as empty', () => {
    const entry = projectRegisterEntry(row({ acceptedBasis: { version: 1 } }), labels)

    expect(entry.unreadable).toBe(true)
    expect(entry.lines).toEqual([])
    expect(entry.documentRefs).toEqual([])
    expect(entry.totalMinor).toBe(0)
    // The identity still renders: a row nobody can read is still a row.
    expect(entry.effectId).toBe('effect1')
    expect(entry.basisHash).toBe('b'.repeat(64))
  })

  it('discards the whole entry when one amount is unreadable, never just the line', () => {
    const basis = acceptedBasis('ship1')
    const entry = projectRegisterEntry(
      row({
        acceptedBasis: {
          ...basis,
          contribution: [
            { ...basis.contribution[0]!, amountMinor: 'not-a-number' },
            basis.contribution[1]!,
          ],
        },
      }),
      labels
    )

    expect(entry.unreadable).toBe(true)
    expect(entry.lines).toEqual([])
  })

  it('tolerates a basis with no account resolution for a line', () => {
    const basis = acceptedBasis('ship1')
    const entry = projectRegisterEntry(
      row({ acceptedBasis: { ...basis, accountResolution: [basis.accountResolution[0]!] } }),
      labels
    )

    expect(entry.unreadable).toBe(false)
    expect(entry.lines[0]?.selectedBy).toBe('org_role')
    expect(entry.lines[1]?.selectedBy).toBeNull()
  })
})

describe('registerTotalMinor', () => {
  it('sums the member debits', () => {
    const entries = [projectRegisterEntry(row(), labels), projectRegisterEntry(row(), labels)]

    expect(registerTotalMinor(entries)).toBe(200)
  })

  it('is zero for a posting with no members', () => {
    expect(registerTotalMinor([])).toBe(0)
  })
})

describe('registerTiesToPosting', () => {
  it('ties when the members add up to the summary', () => {
    expect(registerTiesToPosting(register([projectRegisterEntry(row(), labels)], 100))).toBe(true)
  })

  it('does not tie when they disagree', () => {
    expect(registerTiesToPosting(register([projectRegisterEntry(row(), labels)], 250))).toBe(false)
  })

  it('answers null for a 1:1 posting, never "short by the whole amount"', () => {
    // §7.3.3: seven posting families have no upstream transaction at all. The
    // posting IS the register row, and zero members is "none", not "missing".
    expect(registerTiesToPosting(register([], 4200))).toBeNull()
  })

  it('answers null when a member could not be read, rather than blaming the books', () => {
    const unreadable = projectRegisterEntry(row({ acceptedBasis: null }), labels)

    expect(registerTiesToPosting(register([unreadable], 100))).toBeNull()
  })
})
