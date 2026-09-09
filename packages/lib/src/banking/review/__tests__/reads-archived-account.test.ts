// packages/lib/src/banking/review/__tests__/reads-archived-account.test.ts
//
// plans/bank-connection/08-removing-a-bank-account.md §6.1.
//
// 🛑 `listForReview` filtered `archivedAt IS NULL` on the bank_transaction row
// and never looked at the ACCOUNT. So archiving an account hid it from settings
// and from every picker while its lines kept appearing in the queue - under an
// account the reader could no longer see, select or filter by, and therefore
// could not act on. The archive's exclusion sweep hid the symptom for small
// accounts and missed it entirely above its old 500-row cap.
//
// The account join is therefore UNCONDITIONAL now: it used to be made only when
// filtering by account, because filtering was the only thing it was for. These
// pin that it happens even when no account filter is passed, which is the shape
// the regression had.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every join the builder was asked to make, in order. */
  joins: [] as string[],
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: async () => 'def_bt',
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attributes: string[]) =>
        Object.fromEntries(attributes.map((attribute) => [attribute, { id: `f:${attribute}` }])),
    }),
  }),
}))
vi.mock('../../reads', () => ({
  listBankAccounts: async () => ({ isOk: () => true, value: [] }),
  readCoverage: async () => ({ isOk: () => true, isErr: () => false, value: {} }),
}))

const { listForReview } = await import('../reads')

/** Chainable, thenable, and records which joins were asked for. */
function chain(): Record<string, unknown> {
  const answer = () => Object.assign(Promise.resolve([]), chain())
  return {
    from: answer,
    innerJoin: () => {
      h.joins.push('inner')
      return Object.assign(Promise.resolve([]), chain())
    },
    leftJoin: () => {
      h.joins.push('left')
      return Object.assign(Promise.resolve([]), chain())
    },
    where: answer,
    orderBy: answer,
    limit: answer,
    offset: answer,
    groupBy: answer,
    $dynamic: answer,
  }
}

const db = { select: () => chain() } as never

beforeEach(() => {
  h.joins.length = 0
})

describe('listForReview joins the bank account so an archived one drops out', () => {
  it('joins the account even when NOT filtering by account', async () => {
    await listForReview(db, { organizationId: 'org_1' })

    // Two of them: the account's FieldValue, then the account's EntityInstance,
    // which is the row carrying `archivedAt`.
    expect(h.joins.filter((join) => join === 'left').length).toBeGreaterThanOrEqual(2)
  })

  it('joins the account when filtering by one, and does it with a LEFT join', async () => {
    await listForReview(db, { organizationId: 'org_1', bankAccountId: 'acct_1' })

    // ⚠️ LEFT, not INNER, and the difference is load-bearing. A line whose
    // account link is missing entirely is an orphan, not an archived account's
    // row; an inner join would swallow it and it would never be reviewable.
    expect(h.joins.filter((join) => join === 'left').length).toBeGreaterThanOrEqual(2)
  })
})
