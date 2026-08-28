// packages/lib/src/postings/__tests__/default-chart.test.ts
//
// The chart is DATA, so these are the assertions data can break silently.
//
// The first block is the important one: `ACCOUNT_ROLES` (the code contract,
// client-safe, in build-entry.ts) and `GlAccountRole` (the storage contract, the
// SINGLE_SELECT's option list) are two copies of one vocabulary, for the same
// reason `POSTING_TYPES` is a copy. Two copies drift. An exact-set-equality test
// makes adding a role one atomic change instead of two that can be shipped a
// week apart - and the failure mode it prevents is a builder emitting a role no
// org can map, which fails at the resolver in front of a close.

import { describe, expect, it } from 'vitest'
import { GlAccountRole, GlAccountType } from '../../resources/registry/enum-values'
import { ACCOUNT_ROLES } from '../build-entry'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../default-chart'

const CODE_ROLE_VALUES = Object.values(ACCOUNT_ROLES)
const REGISTRY_ROLE_VALUES = GlAccountRole.values.map((option) => option.value)

describe('the role vocabulary is one vocabulary', () => {
  it('ACCOUNT_ROLES and GlAccountRole hold exactly the same values', () => {
    expect([...CODE_ROLE_VALUES].sort()).toEqual([...REGISTRY_ROLE_VALUES].sort())
  })

  it('declares no role twice', () => {
    expect(new Set(REGISTRY_ROLE_VALUES).size).toBe(REGISTRY_ROLE_VALUES.length)
  })

  it('gives every role a human label - a bookkeeper picks from this list', () => {
    for (const option of GlAccountRole.values) {
      expect(option.label, `role ${option.value}`).toBeTruthy()
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

  it('carries the four accounts the accrual plan does not list but a builder needs', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))
    expect(byCode.get('1000')?.role).toBe(ACCOUNT_ROLES.CASH)
    expect(byCode.get('2000')?.role).toBe(ACCOUNT_ROLES.ACCOUNTS_PAYABLE)
    expect(byCode.get('2160')?.role).toBe(ACCOUNT_ROLES.GRNI)
    expect(byCode.get('2170')?.role).toBe(ACCOUNT_ROLES.DUTIES_ACCRUAL)
  })

  // 1320 WIP is deliberately absent from a RECEIPT posting - nothing in the
  // `partKind` table maps to it. That is a rule about receipts, not about the
  // chart: the L1 month-end inventory entry moves all three inventory accounts.
  it('seeds WIP even though no receipt ever debits it', () => {
    const wip = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === '1320')
    expect(wip?.role).toBe(ACCOUNT_ROLES.INVENTORY_WIP)
  })
})
