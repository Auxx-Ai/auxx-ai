// packages/lib/src/accounting/connect-and-go/__tests__/prepare.test.ts

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  providerId: 'acme',
  company: null as Record<string, unknown> | null,
  settings: {} as Record<string, string | null>,
  writes: [] as { key: string; value: string }[][],
  memberZone: null as string | null,
  chart: [] as { id: string }[],
  importResult: {
    created: 3,
    alreadyImported: 0,
    skippedInactive: 0,
    rolesAssigned: [],
    rolesAmbiguous: [] as { role: string; providerAccountIds: string[] }[],
    coreCreated: [],
    nestedUnder: 0,
  },
  importFails: false,
  importOptions: [] as Record<string, unknown>[],
  roleMap: [] as { role: string; state: string }[],
  mappings: new Map<string, string>(),
  identities: [] as Record<string, unknown>[],
  pushed: [] as string[][],
  mintable: [] as string[],
  mapped: new Set<string>(),
  mintAsked: [] as string[][],
}))

vi.mock('../lock', () => ({
  withSetupLock: async (_db: unknown, _org: string, fn: () => Promise<unknown>) => {
    h.calls.push('lock')
    return fn()
  },
}))
vi.mock('../../providers/provider', () => ({
  NONE_PROVIDER_ID: 'none',
  resolveAccountingProvider: async () => ({
    id: h.providerId,
    readCompanySettings: async () => {
      h.calls.push('company')
      return ok(h.company)
    },
    listAccountMappings: async () => ok(h.mappings),
  }),
  supportsCreatingProviderAccounts: () => true,
}))
vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => h.settings,
}))
vi.mock('../../../settings/settings-service', () => ({
  batchUpdateOrganizationSettings: async (input: {
    settings: { key: string; value: string }[]
  }) => {
    h.calls.push('settings')
    h.writes.push(input.settings)
  },
}))
vi.mock('../../../cache', () => ({
  getCachedMembersByUserIds: async () => [{ user: { preferredTimezone: h.memberZone } }],
}))
vi.mock('../../ledger/roles/role-map', () => ({
  listChartAccounts: async () => ok(h.chart),
  listRoleMap: async () => ok(h.roleMap),
}))
vi.mock('../../providers/account-identities', () => ({
  confirmSuggestedIdentities: async () => {
    h.calls.push('suggestions')
    return ok({ confirmed: 2, failures: [] })
  },
  listAccountIdentities: async () => ok({ rows: h.identities }),
}))
vi.mock('../../ledger/chart/chart-import', () => ({
  importChartFromProvider: async (_db: unknown, options: Record<string, unknown>) => {
    h.calls.push('chart')
    h.importOptions.push(options)
    return h.importFails ? err(new Error('provider down')) : ok(h.importResult)
  },
  // Stands in for the real minter: mints each unmapped role once, then it is mapped.
  mintMissingRoleAccounts: async (_db: unknown, options: { roles: string[] }) => {
    h.calls.push('mint')
    h.mintAsked.push(options.roles)
    const minted = options.roles
      .filter((role) => h.mintable.includes(role) && !h.mapped.has(role))
      .map((role) => ({ role, glAccountId: `gl_${role}`, name: role }))
    for (const row of minted) {
      h.mapped.add(row.role)
      h.identities.push({
        account: { id: row.glAccountId, name: row.name, code: null },
        providerAccountId: null,
        suggestion: null,
      })
    }
    return ok(minted)
  },
}))
vi.mock('../../providers/create-provider-accounts', () => ({
  createProviderAccounts: async (_db: unknown, options: { glAccountIds: string[] }) => {
    h.calls.push('push')
    h.pushed.push(options.glAccountIds)
    return ok({
      created: options.glAccountIds.map((id) => ({ id })),
      skipped: [],
      ancestorsAdded: [],
    })
  },
}))
vi.mock('../auto-route-rails', () => ({
  autoRouteRails: async () => {
    h.calls.push('rails')
    return ok({
      created: [],
      banked: [],
      skipped: [],
      questions: [
        { kind: 'rail_bank', gatewayId: 'gw_1', name: 'Stripe', candidateAccountIds: [] },
      ],
      failed: [],
    })
  },
}))
vi.mock('../bank-account-reads', () => ({
  planBankAccountsFromProvider: async () => {
    h.calls.push('banks')
    return ok({ proposals: [{ key: 'create:gl_bank', kind: 'create' }], notes: [] })
  },
}))

import { ROLES_REQUIRED_BY_ENABLED_POSTING_TYPES } from '../../ledger/roles/regime'
import { prepareConnectAndGo } from '../prepare'

const db = {} as Database
const base = {
  organizationId: 'org_1',
  actorUserId: 'usr_1',
  today: new Date('2026-09-23T12:00:00Z'),
}

beforeEach(() => {
  h.calls = []
  h.providerId = 'acme'
  h.company = { fiscalYearStartMonth: 4, lockDate: null }
  h.settings = { 'accounting.fiscalYearStartMonth': '1', 'accounting.bookTimeZone': null }
  h.writes = []
  h.memberZone = 'America/New_York'
  h.chart = []
  h.importResult.rolesAmbiguous = []
  h.importFails = false
  h.importOptions = []
  h.roleMap = []
  h.mappings = new Map()
  h.identities = []
  h.pushed = []
  h.mintable = []
  h.mapped = new Set()
  h.mintAsked = []
})

describe('prepareConnectAndGo', () => {
  it('refuses when no provider is connected', async () => {
    h.providerId = 'none'
    const result = await prepareConnectAndGo(db, base)
    expect(result.isErr()).toBe(true)
  })

  it('runs company settings, chart, rails and bank plan in that order, writing nothing to the provider', async () => {
    h.identities = [
      {
        account: { id: 'gl_minted', name: 'WIP', code: '1310' },
        providerAccountId: null,
        suggestion: null,
      },
      { account: { id: 'gl_linked' }, providerAccountId: 'p_1', suggestion: null },
      { account: { id: 'gl_suggested' }, providerAccountId: null, suggestion: { account: {} } },
      {
        account: { id: 'gl_archived', isArchived: true },
        providerAccountId: null,
        suggestion: null,
      },
    ]
    const report = (await prepareConnectAndGo(db, base))._unsafeUnwrap()

    expect(h.calls).toEqual(['lock', 'company', 'settings', 'chart', 'rails', 'mint', 'banks'])
    expect(h.pushed).toEqual([])
    expect(report.providerAccountsToCreate).toEqual([
      { glAccountId: 'gl_minted', name: 'WIP', code: '1310' },
    ])
    expect(report.questions.rails).toHaveLength(1)
    expect(report.questions.bankAccounts).toEqual([{ key: 'create:gl_bank', kind: 'create' }])
    expect(report.failures).toEqual([])
  })

  it('imports the whole chart into an empty one and refreshes an existing one after linking', async () => {
    await prepareConnectAndGo(db, base)
    expect(h.importOptions[0]).toMatchObject({ refreshOnly: false })
    expect(h.calls).not.toContain('suggestions')

    h.calls = []
    h.chart = [{ id: 'gl_1' }]
    const report = (await prepareConnectAndGo(db, base))._unsafeUnwrap()
    expect(h.importOptions[1]).toMatchObject({ refreshOnly: true })
    expect(h.calls.indexOf('suggestions')).toBeLessThan(h.calls.indexOf('chart'))
    expect(report.chart).toMatchObject({ mode: 'refresh', suggestionsLinked: 2 })
  })

  it('writes the fiscal year and a missing timezone, and writes nothing once they agree', async () => {
    const first = (await prepareConnectAndGo(db, base))._unsafeUnwrap()
    expect(h.writes).toEqual([
      [
        { key: 'accounting.fiscalYearStartMonth', value: '4' },
        { key: 'accounting.bookTimeZone', value: 'America/New_York' },
      ],
    ])
    expect(first).toMatchObject({
      fiscalYearStartMonthWritten: 4,
      bookTimeZone: 'America/New_York',
      bookTimeZoneWritten: true,
    })

    h.writes = []
    h.settings = {
      'accounting.fiscalYearStartMonth': '4',
      'accounting.bookTimeZone': 'America/New_York',
    }
    const second = (await prepareConnectAndGo(db, base))._unsafeUnwrap()
    expect(h.writes).toEqual([])
    expect(second.fiscalYearStartMonthWritten).toBeNull()
    expect(second.bookTimeZoneWritten).toBe(false)
  })

  it('proposes the cutover without writing it', async () => {
    h.company = { fiscalYearStartMonth: null, lockDate: '2025-12-31' }
    const report = (await prepareConnectAndGo(db, base))._unsafeUnwrap()
    expect(report.proposedCutover).toEqual({ cutoffPeriod: '2025-12', source: 'lock_date' })
    expect(h.writes.flat().map((write) => write.key)).not.toContain('accounting.cutoffPeriod')
  })

  it('asks about ambiguous roles still unmapped, offering the linked accounts', async () => {
    h.importResult.rolesAmbiguous = [
      { role: 'revenue_product', providerAccountIds: ['p_a', 'p_b', 'p_gone'] },
      { role: 'sales_tax_payable', providerAccountIds: ['p_c', 'p_d'] },
    ]
    h.roleMap = [
      { role: 'revenue_product', state: 'unmapped' },
      { role: 'sales_tax_payable', state: 'confirmed' },
    ]
    h.mappings = new Map([
      ['gl_a', 'p_a'],
      ['gl_b', 'p_b'],
    ])
    const report = (await prepareConnectAndGo(db, base))._unsafeUnwrap()
    expect(report.questions.roles).toEqual([
      { role: 'revenue_product', candidateAccountIds: ['gl_a', 'gl_b'] },
    ])
  })

  it('reports a refused step and runs the rest', async () => {
    h.importFails = true
    const report = (await prepareConnectAndGo(db, base))._unsafeUnwrap()
    expect(report.failures).toEqual([{ step: 'chart', message: 'provider down' }])
    expect(report.chart).toBeNull()
    expect(h.calls).toEqual(['lock', 'company', 'settings', 'chart', 'rails', 'banks'])
  })
})

describe('prepareConnectAndGo: roles nothing in the chart fits', () => {
  it('mints the unmapped roles the enabled posting types need, and lists them for Finish', async () => {
    h.mintable = ['inventory_raw_materials', 'inventory_wip']
    const report = (await prepareConnectAndGo(db, base))._unsafeUnwrap()

    expect(h.mintAsked[0]).toEqual(ROLES_REQUIRED_BY_ENABLED_POSTING_TYPES)
    expect(report.rolesMinted.map((row) => row.role)).toEqual([
      'inventory_raw_materials',
      'inventory_wip',
    ])
    expect(h.pushed).toEqual([])
    expect(report.providerAccountsToCreate?.map((row) => row.glAccountId)).toEqual([
      'gl_inventory_raw_materials',
      'gl_inventory_wip',
    ])
  })

  it('never mints a role that is a question', async () => {
    h.importResult.rolesAmbiguous = [
      { role: 'inventory_raw_materials', providerAccountIds: ['p_a', 'p_b'] },
    ]
    h.mintable = ['inventory_raw_materials', 'inventory_wip']
    const report = (await prepareConnectAndGo(db, base))._unsafeUnwrap()

    expect(h.mintAsked[0]).not.toContain('inventory_raw_materials')
    expect(report.rolesMinted.map((row) => row.role)).toEqual(['inventory_wip'])
  })

  it('mints nothing on a second run', async () => {
    h.mintable = ['inventory_wip']
    await prepareConnectAndGo(db, base)
    const second = (await prepareConnectAndGo(db, base))._unsafeUnwrap()
    expect(second.rolesMinted).toEqual([])
  })
})
