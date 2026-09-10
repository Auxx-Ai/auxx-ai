// packages/lib/src/postings/__tests__/chart-import-plan.test.ts
//
// `planChartImport` is pure - no database, no doubles - so every test here
// hands it plain arrays and a map and reads the plan back.

import { describe, expect, it } from 'vitest'
import {
  PROVIDER_ACCOUNT_TYPE_SUBTYPE,
  planChartImport,
  ROLE_IMPORT_MATCH,
} from '../chart-import-plan'
import { CHART_PACKS } from '../default-chart'
import { SUBTYPE_PROVIDER_ACCOUNT_TYPES } from '../suggest-account-identities'
import type { ChartAccountRow, ProviderAccount, RoleAssignmentRow } from '../types'

function providerAccount(over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'p1',
    name: 'Checking',
    fullyQualifiedName: 'Checking',
    number: null,
    accountType: 'Bank',
    classification: 'asset',
    active: true,
    ...over,
  }
}

/** Every declared role, `unmapped` unless overridden. */
function roleMap(overrides: Record<string, RoleAssignmentRow['state']> = {}): RoleAssignmentRow[] {
  const roles = new Set<string>(Object.keys(ROLE_IMPORT_MATCH))
  for (const account of CHART_PACKS.core.accounts) {
    if (account.role) roles.add(account.role)
  }
  return [...roles].map((role) => ({
    role,
    state: overrides[role] ?? 'unmapped',
    accountId: null,
    account: null,
    source: null,
    confirmedAt: null,
  }))
}

const EMPTY_CHART: readonly ChartAccountRow[] = []

describe('PROVIDER_ACCOUNT_TYPE_SUBTYPE is consistent with SUBTYPE_PROVIDER_ACCOUNT_TYPES', () => {
  it('maps every entry to a subtype whose allowed list contains that provider type', () => {
    for (const [providerType, subtype] of Object.entries(PROVIDER_ACCOUNT_TYPE_SUBTYPE)) {
      const allowed = SUBTYPE_PROVIDER_ACCOUNT_TYPES[subtype] ?? []
      expect(allowed, `${providerType} -> ${subtype}`).toContain(providerType)
    }
  })

  it('deliberately omits Other Current Asset', () => {
    expect(PROVIDER_ACCOUNT_TYPE_SUBTYPE['Other Current Asset']).toBeUndefined()
  })
})

describe('create', () => {
  it('turns the provider number into the code, and a missing number into null', () => {
    const plan = planChartImport(
      [
        providerAccount({ id: 'p1', number: '1000' }),
        providerAccount({ id: 'p2', number: null, name: 'No Number' }),
      ],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )

    expect(plan.create.find((c) => c.providerAccount.id === 'p1')?.code).toBe('1000')
    expect(plan.create.find((c) => c.providerAccount.id === 'p2')?.code).toBeNull()
  })

  it('stamps classification as accountType and the declared inverse as subtype', () => {
    const plan = planChartImport(
      [providerAccount({ id: 'p1', accountType: 'Bank', classification: 'asset' })],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )

    const created = plan.create[0]!
    expect(created.accountType).toBe('asset')
    expect(created.subtype).toBe('bank')
  })

  it('leaves the subtype null for an ambiguous provider type', () => {
    const plan = planChartImport(
      [providerAccount({ id: 'p1', accountType: 'Other Current Asset' })],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )

    expect(plan.create[0]?.subtype).toBeNull()
  })

  it('skips an inactive account entirely', () => {
    const plan = planChartImport(
      [providerAccount({ id: 'p1', active: false })],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )

    expect(plan.create).toHaveLength(0)
    expect(plan.skippedInactive.map((a) => a.id)).toEqual(['p1'])
  })

  it('reports an already-imported account by provider id, even when renamed', () => {
    const plan = planChartImport(
      [providerAccount({ id: 'p1', name: 'Renamed Since Import' })],
      EMPTY_CHART,
      new Map([['gl1', 'p1']]),
      roleMap()
    )

    expect(plan.create).toHaveLength(0)
    expect(plan.alreadyImported).toEqual([
      {
        providerAccount: expect.objectContaining({ id: 'p1', name: 'Renamed Since Import' }),
        glAccountId: 'gl1',
      },
    ])
  })
})

describe('roleCandidates', () => {
  it('resolves accounts_receivable to the one Accounts Receivable subtype account', () => {
    const plan = planChartImport(
      [
        providerAccount({
          id: 'ar1',
          accountType: 'Accounts Receivable',
          classification: 'asset',
        }),
      ],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )

    expect(plan.roleCandidates).toContainEqual({
      role: 'accounts_receivable',
      match: 'subtype',
      providerAccountId: 'ar1',
    })
  })

  it('leaves the role unresolved when two candidates tie', () => {
    const plan = planChartImport(
      [
        providerAccount({ id: 'ar1', accountType: 'Accounts Receivable', classification: 'asset' }),
        providerAccount({ id: 'ar2', accountType: 'Accounts Receivable', classification: 'asset' }),
      ],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )

    expect(plan.roleCandidates.some((c) => c.role === 'accounts_receivable')).toBe(false)
  })

  it('never proposes a candidate for a role that is already mapped', () => {
    const plan = planChartImport(
      [providerAccount({ id: 'ar1', accountType: 'Accounts Receivable', classification: 'asset' })],
      EMPTY_CHART,
      new Map(),
      roleMap({ accounts_receivable: 'confirmed' })
    )

    expect(plan.roleCandidates.some((c) => c.role === 'accounts_receivable')).toBe(false)
  })

  it('matches Undeposited Funds by plain name and by a fully-qualified one', () => {
    const plainPlan = planChartImport(
      [
        providerAccount({
          id: 'u1',
          name: 'Undeposited Funds',
          accountType: 'Other Current Asset',
        }),
      ],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )
    expect(plainPlan.roleCandidates).toContainEqual({
      role: 'undeposited_funds',
      match: 'name',
      providerAccountId: 'u1',
    })

    const qualifiedPlan = planChartImport(
      [
        providerAccount({
          id: 'u2',
          name: 'Undeposited Funds',
          fullyQualifiedName: 'Bank:Undeposited Funds',
          accountType: 'Other Current Asset',
        }),
      ],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )
    expect(qualifiedPlan.roleCandidates).toContainEqual({
      role: 'undeposited_funds',
      match: 'name',
      providerAccountId: 'u2',
    })
  })
})

describe('missingCore', () => {
  it('lists each core role-bearing account with no candidate, and nothing else', () => {
    // Nothing in the provider chart resolves any role, so every core
    // role-bearing account is missing.
    const plan = planChartImport(
      [providerAccount({ id: 'p1', name: 'Something Unrelated', accountType: 'Fixed Asset' })],
      EMPTY_CHART,
      new Map(),
      roleMap()
    )

    const expectedRoles = CHART_PACKS.core.accounts.flatMap((a) => (a.role ? [a.role] : []))
    expect(plan.missingCore.map((a) => a.role).sort()).toEqual(expectedRoles.sort())
    // Nothing else - every entry comes from the core pack alone.
    for (const account of plan.missingCore) {
      expect(CHART_PACKS.core.accounts).toContain(account)
    }
  })

  it('excludes a core role a candidate resolved, and one already mapped', () => {
    const plan = planChartImport(
      [providerAccount({ id: 'ar1', accountType: 'Accounts Receivable', classification: 'asset' })],
      EMPTY_CHART,
      new Map(),
      roleMap({ accounts_payable: 'confirmed' })
    )

    const roles = plan.missingCore.map((a) => a.role)
    expect(roles).not.toContain('accounts_receivable')
    expect(roles).not.toContain('accounts_payable')
  })
})
