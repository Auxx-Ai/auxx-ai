// packages/lib/src/postings/__tests__/default-chart.test.ts
//
// The chart is DATA, so these are the assertions data can break silently.
//
// The first block used to pin `ACCOUNT_ROLES` against `GlAccountRole` - two
// copies of one vocabulary, kept honest by exact-set equality. Decision `G19`
// deleted the second copy along with the `gl_account.role` SINGLE_SELECT it
// existed to populate, so the vocabulary now has ONE home. What replaces that
// test is the same shape aimed at the two satellite tables that would otherwise
// drift instead: `ROLE_ACCOUNT_TYPES` and `ACCOUNT_ROLE_LABELS`, both keyed by
// role, and both of which a new role must be added to in the same change.
//
// Only an EXACT-set assertion catches a removal; a subset assertion passes
// forever.

import { describe, expect, it } from 'vitest'
import { GlAccountType } from '../../resources/registry/enum-values'
import { ACCOUNT_ROLE_LABELS, ACCOUNT_ROLES, ROLE_ACCOUNT_TYPES } from '../build-entry'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../default-chart'

const CODE_ROLE_VALUES = Object.values(ACCOUNT_ROLES)

describe('the role vocabulary is one vocabulary', () => {
  it('declares no role twice', () => {
    expect(new Set(CODE_ROLE_VALUES).size).toBe(CODE_ROLE_VALUES.length)
  })

  // A role with no declared account type resolves UNCHECKED: `resolveRoles`
  // would have nothing to compare the account against, so pointing `grni` at a
  // revenue account would post and balance. Exact equality, both directions.
  it('declares a permitted account type for exactly the roles that exist', () => {
    expect(Object.keys(ROLE_ACCOUNT_TYPES).sort()).toEqual([...CODE_ROLE_VALUES].sort())
  })

  it('permits only the five statement classifications', () => {
    const types = new Set<string>(GlAccountType.values.map((option) => option.value))
    for (const [role, accountType] of Object.entries(ROLE_ACCOUNT_TYPES)) {
      expect(types.has(accountType), `role ${role} -> ${accountType}`).toBe(true)
    }
  })

  it('gives every role a human label - the build ledger renders one', () => {
    expect(Object.keys(ACCOUNT_ROLE_LABELS).sort()).toEqual([...CODE_ROLE_VALUES].sort())
    for (const [role, label] of Object.entries(ACCOUNT_ROLE_LABELS)) {
      expect(label.trim(), `role ${role}`).toBeTruthy()
    }
  })
})

describe('the chart agrees with the declared account types', () => {
  // The seeded default must satisfy the very check `resolveRoles` runs at a
  // close. A chart that ships a role on an account of the wrong type would make
  // every org fail closed on its first posting, with no edit of their own to
  // blame.
  it('seeds every role onto an account of its permitted type', () => {
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      if (!account.role) continue
      expect(account.accountType, `${account.code} ${account.role}`).toBe(
        ROLE_ACCOUNT_TYPES[account.role]
      )
    }
  })
})

describe('the default chart', () => {
  it('has a unique code per account - `code` is the org-unique identity', () => {
    const codes = DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('gives every account a code, a name and a statement type', () => {
    const types = new Set<string>(GlAccountType.values.map((option) => option.value))
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(account.code.trim(), account.code).toBeTruthy()
      expect(account.name.trim(), account.code).toBeTruthy()
      expect(types.has(account.accountType), `${account.code} ${account.accountType}`).toBe(true)
    }
  })

  // THE uniqueness rule the `role` field's `unique: true` capability enforces at
  // the write door. Asserted on the seed data too, because the seeder is a
  // single writer and a duplicate here would be written before any gate runs.
  it('assigns each role to AT MOST one account', () => {
    const assigned = DEFAULT_CHART_OF_ACCOUNTS.flatMap((account) =>
      account.role ? [account.role] : []
    )
    expect(new Set(assigned).size).toBe(assigned.length)
  })

  // The other half: a role no account carries is a builder that cannot post.
  // `assertAccountRolesResolve` would fail the entry with `account_unmapped`
  // before the period was claimed - correct behaviour, but it should never be
  // reachable from the DEFAULT chart, which is the whole point of shipping the
  // roles pre-assigned (`G8`).
  it('assigns EVERY role the builders can emit', () => {
    const assigned = new Set(
      DEFAULT_CHART_OF_ACCOUNTS.flatMap((account) => (account.role ? [account.role] : []))
    )
    expect([...CODE_ROLE_VALUES].filter((role) => !assigned.has(role))).toEqual([])
  })

  it('leaves the accounts auxx does not post to role-less', () => {
    // Role-less is the ORDINARY case, not a gap. Pinned so that a future edit
    // that reflexively gives every account a role has to argue with a test.
    const roleless = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => !account.role)
    expect(roleless.length).toBeGreaterThan(0)
    expect(roleless.map((account) => account.code)).toContain('1210') // Affirm Clearing
    expect(roleless.map((account) => account.code)).toContain('6200') // Fulfillment Labor
  })

  // 2110 Payroll Clearing carries assembly labour that CAPITALISES into
  // inventory; 6200 Fulfillment Labor is pick/pack/receive and explicitly does
  // NOT. Collapsing them into one "labour" role would misstate COGS, so the
  // split is pinned rather than left to a reader's care.
  it('keeps capitalised assembly labour and non-inventory fulfilment labour apart', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))
    expect(byCode.get('2110')?.role).toBe(ACCOUNT_ROLES.PAYROLL_CLEARING)
    expect(byCode.get('6200')?.role).toBeUndefined()
  })

  // Inbound freight is CAPITALISED into landed cost and accrues to a liability;
  // outbound freight is an expense above gross profit. Two different freights.
  it('does not point the freight accrual role at outbound freight', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))
    expect(byCode.get('2150')?.role).toBe(ACCOUNT_ROLES.FREIGHT_ACCRUAL)
    expect(byCode.get('5030')?.role).toBeUndefined()
  })

  it('carries the five accounts the accrual plan does not list but a builder needs', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))
    expect(byCode.get('1000')?.role).toBe(ACCOUNT_ROLES.CASH)
    expect(byCode.get('2000')?.role).toBe(ACCOUNT_ROLES.ACCOUNTS_PAYABLE)
    expect(byCode.get('2160')?.role).toBe(ACCOUNT_ROLES.GRNI)
    expect(byCode.get('2170')?.role).toBe(ACCOUNT_ROLES.DUTIES_ACCRUAL)
    expect(byCode.get('5095')?.role).toBe(ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE)
  })

  // `G12`: count/shrinkage value must land somewhere OTHER than purchase price
  // variance. One account holding both makes the two indistinguishable in every
  // period total, which is the whole reason the second account exists.
  it('keeps purchase price variance and inventory count variance apart', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))
    expect(byCode.get('5090')?.role).toBe(ACCOUNT_ROLES.PPV)
    expect(byCode.get('5095')?.role).toBe(ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE)
    expect(byCode.get('5090')?.role).not.toBe(byCode.get('5095')?.role)
  })

  // `G17`: a customs broker's service charge is landed cost and clears through
  // 2150, not through 2170. Three files used to say otherwise. The account NAME
  // is what a bookkeeper reads, so it is the thing pinned here — the ROLE stays
  // `freight_accrual` on purpose.
  it('names 2150 for brokerage as well as freight', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))
    expect(byCode.get('2150')?.name).toBe('Inbound Freight & Brokerage Accrual')
    expect(byCode.get('2150')?.role).toBe(ACCOUNT_ROLES.FREIGHT_ACCRUAL)
    expect(byCode.get('2170')?.name).toBe('Duties Accrual')
  })

  // 1320 WIP is deliberately absent from a RECEIPT posting - nothing in the
  // `partKind` table maps to it. That is a rule about receipts, not about the
  // chart: the L1 month-end inventory entry moves all three inventory accounts.
  it('seeds WIP even though no receipt ever debits it', () => {
    const wip = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === '1320')
    expect(wip?.role).toBe(ACCOUNT_ROLES.INVENTORY_WIP)
  })
})
