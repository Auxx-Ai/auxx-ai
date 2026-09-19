// packages/lib/src/data-migrations/migrations/__tests__/181-rewalk-provisioned-chart-packs.test.ts
//
// The migration's whole decision is WHICH packs it hands to `seedChartPacks`
// (75-D2), so that is what is pinned here. The seeder's own rules - idempotent
// on `code`, never repoints a mapped role - are pinned in
// `seed/__tests__/gl-account-chart.test.ts`; the fake below only reproduces the
// first of them, so "gains 5093 and nothing else" is a real assertion.

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPackKey,
} from '../../../accounting/ledger/chart/default-chart'
import type { Migration181Result } from '../181-rewalk-provisioned-chart-packs'

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['gl_account']

/** Roles the org has mapped - everything else reads `unmapped`. */
let mappedRoles: string[] = []

/** Account codes the org already holds, in the shape the fake seeder skips on. */
let heldCodes: Set<string> = new Set()

const seedCalls: ChartPackKey[][] = []
const createdCodes: string[] = []

vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
}))

vi.mock('../../../accounting/ledger/roles/role-map', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listRoleMap: async () => ok(mappedRoles.map((role) => ({ role, state: 'confirmed' as const }))),
}))

vi.mock('../../../seed/gl-account-chart', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    seedChartPacks: async (
      _db: unknown,
      _organizationId: string,
      _defId: string,
      packs: readonly ChartPackKey[]
    ) => {
      seedCalls.push([...packs])
      // `core` plus each pack's `requires`, transitively - what the real walk does.
      const wanted = new Set<ChartPackKey>(['core', ...packs])
      for (const key of [...wanted]) {
        for (const required of CHART_PACKS[key].requires ?? []) wanted.add(required)
      }
      const walked = CHART_PACK_KEYS.filter((key) => wanted.has(key))
      const accounts = walked.flatMap((key) => CHART_PACKS[key].accounts)
      const missing = accounts.filter((account) => !heldCodes.has(account.code))
      for (const account of missing) {
        heldCodes.add(account.code)
        createdCodes.push(account.code)
      }
      return {
        created: missing.length,
        skipped: accounts.length - missing.length,
        rolesAssigned: 0,
        packs: walked,
      }
    },
  }
})

const { migration181RewalkProvisionedChartPacks } = await import(
  '../181-rewalk-provisioned-chart-packs'
)
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')

const MIGRATION_ID = '181-rewalk-provisioned-chart-packs'
const ORG = 'org_1'
const DB = {} as Database

/** Every role a pack's accounts carry. */
const rolesOf = (...packs: ChartPackKey[]): string[] =>
  packs.flatMap((pack) => CHART_PACKS[pack].accounts.flatMap((a) => (a.role ? [a.role] : [])))

/** Every code a pack's accounts carry. */
const codesOf = (...packs: ChartPackKey[]): string[] =>
  packs.flatMap((pack) => CHART_PACKS[pack].accounts.map((a) => a.code))

const runUp = () =>
  migration181RewalkProvisionedChartPacks.up(DB, ORG) as unknown as Promise<Migration181Result>

/** An org that adopted core, inventory and purchasing before 5093 joined the catalogue. */
function anOrgMissing5093() {
  existingDefs = ['gl_account']
  mappedRoles = rolesOf('core', 'inventory', 'purchasing').filter(
    (role) => role !== 'purchase_discounts'
  )
  heldCodes = new Set(codesOf('core', 'inventory', 'purchasing').filter((code) => code !== '5093'))
}

beforeEach(() => {
  seedCalls.length = 0
  createdCodes.length = 0
  anOrgMissing5093()
})

describe('migration 181 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration181RewalkProvisionedChartPacks.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 181, and the registry stays sorted', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    const numbers = ids.map((id) => id.split('-')[0])
    expect(numbers.filter((n) => n === '181')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('migration 181 up()', () => {
  it('re-walks the partial purchasing pack and lands 5093, and nothing else', async () => {
    const result = await runUp()

    expect(result.packsRewalked).toEqual(['purchasing'])
    expect(createdCodes).toEqual(['5093'])
    expect(result.accountsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
  })

  it('never walks an absent pack, so payroll gains nothing', async () => {
    await runUp()

    expect(seedCalls.flat()).not.toContain('payroll')
    for (const code of codesOf('payroll', 'fixed_assets', 'debt')) {
      expect(createdCodes).not.toContain(code)
    }
  })

  it('is a no-op on a re-run: nothing is partial any more', async () => {
    await runUp()
    mappedRoles = rolesOf('core', 'inventory', 'purchasing')
    seedCalls.length = 0
    createdCodes.length = 0

    const again = await runUp()

    expect(again.alreadyUpToDate).toBe(true)
    expect(again.packsRewalked).toEqual([])
    expect(seedCalls).toEqual([])
    expect(createdCodes).toEqual([])
  })

  it('is a no-op for an org with no gl_account definition, not an error', async () => {
    existingDefs = []

    const result = await runUp()

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.accountsCreated).toBe(0)
    expect(seedCalls).toEqual([])
  })

  it('is a no-op for an org with no chart at all - every pack reads absent', async () => {
    mappedRoles = []
    heldCodes = new Set()

    const result = await runUp()

    expect(result.alreadyUpToDate).toBe(true)
    expect(seedCalls).toEqual([])
  })
})
