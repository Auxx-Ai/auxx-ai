// packages/lib/src/data-migrations/migrations/166-one-mapping-table.test.ts
//
// Three independent operations in one `up()`, so what actually goes wrong is
// per-part, not shared:
//
//  - the six payment_gateway fields and their bank_account inverse must be
//    gone from the REGISTRY, or a fresh org keeps seeding what this brief
//    retires;
//  - settlementDestinations must be TAGS, not a leftover TEXT with a new
//    name - the whole point of §4.4 is the storage column, not the label;
//  - a re-run must find nothing left to remove, retype or add, on an org
//    that already took this migration once;
//  - an org short of a def is a SKIP on that part alone, never a throw.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../resources/registry/field-types'
import type { Migration166Result } from './166-one-mapping-table'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['payment_gateway', 'bank_account', 'payout']
/** Payout field keys the stubbed `ensureCustomFields` reports as already present. */
let existingPayoutFieldKeys: string[] = []
/** Every `ensureCustomFields` call this run made, for the Part C assertions. */
const ensureCalls: { entityType: string; defId: string; fieldKeys: string[] }[] = []

// Spread the original: `registry.ts` also imports other per-org migrations,
// which need `ensureEntityDefinitions`, `linkNewRelationships` and
// `linkDisplayFields` to exist as named exports at import time.
vi.mock('../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
  ensureCustomFields: async (
    _db: unknown,
    _organizationId: string,
    entityType: string,
    defId: string,
    fields: Record<string, ResourceField>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    const fieldKeys = Object.keys(fields)
    ensureCalls.push({ entityType, defId, fieldKeys })
    for (const key of fieldKeys) {
      if (!existingPayoutFieldKeys.includes(key)) state.fieldsCreated++
    }
    return new Map()
  },
}))

const { migration166OneMappingTable } = await import('./166-one-mapping-table')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../registry')
const { PAYMENT_GATEWAY_FIELDS } = await import(
  '../../resources/registry/resources/payment-gateway-fields'
)
const { BANK_ACCOUNT_FIELDS } = await import(
  '../../resources/registry/resources/bank-account-fields'
)
const { PAYOUT_FIELDS } = await import('../../resources/registry/resources/payout-fields')

const MIGRATION_ID = '166-one-mapping-table'
const ORG = 'org_1'

/** `PerOrgMigration.up` narrows the return type to the shared interface; this restores the richer one for assertions. */
const runUp = (db: Database) =>
  migration166OneMappingTable.up(db, ORG) as unknown as Promise<Migration166Result>

/** Part A/B touch `db` directly (no `entity-helpers` seam), so they get their own fake. */
interface FakeDbOptions {
  /** Ids `.returning()` answers for the six-field gateway delete. */
  gatewayFieldsFound: string[]
  /** Ids `.returning()` answers for the settlementGateways inverse delete. */
  bankInverseFound: string[]
  /** What `CustomField.findFirst` answers when looking for the old Stripe field. */
  stripeField: { id: string } | null
  /** Ids `.returning()` answers for the FieldValue retype update. */
  fieldValuesFound: string[]
}

function makeFakeDb(opts: FakeDbOptions): Database {
  const deleteReturns = [opts.gatewayFieldsFound, opts.bankInverseFound]
  let deleteCallIndex = 0

  return {
    delete: () => {
      const index = deleteCallIndex++
      return {
        where: () => ({
          returning: async () => (deleteReturns[index] ?? []).map((id) => ({ id })),
        }),
      }
    },
    update: (table: unknown) => ({
      set: () => ({
        where: () => {
          if (table === schema.FieldValue) {
            return { returning: async () => opts.fieldValuesFound.map((id) => ({ id })) }
          }
          return Promise.resolve()
        },
      }),
    }),
    query: {
      CustomField: {
        findFirst: async () => opts.stripeField,
      },
    },
  } as unknown as Database
}

function resetStubs() {
  existingDefs = ['payment_gateway', 'bank_account', 'payout']
  existingPayoutFieldKeys = []
  ensureCalls.length = 0
  invalidateAndRecompute.mockClear()
}

describe('migration 166 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration166OneMappingTable.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 166', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '166')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('reaches the shared registry without an entry of its own, sorted by id', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('§4.3 — the six payment_gateway fields are gone from the registry', () => {
  it.each([
    'clearingAccount',
    'feeAccount',
    'settlementSource',
    'settlementAccount',
    'settlementCurrency',
    'settlementBankAccount',
  ])('%s no longer exists', (key) => {
    expect(PAYMENT_GATEWAY_FIELDS[key]).toBeUndefined()
  })

  it('keeps the fields §4.3 names', () => {
    for (const key of [
      'name',
      'handles',
      'feeTreatment',
      'status',
      'lastSettlementAt',
      'lastFeeBookedAt',
      'payouts',
    ]) {
      expect(PAYMENT_GATEWAY_FIELDS[key]).toBeDefined()
    }
  })
})

describe('§4.3 — bank_account.settlementGateways, the inverse, is gone', () => {
  it('no longer exists', () => {
    expect(BANK_ACCOUNT_FIELDS.settlementGateways).toBeUndefined()
  })
})

describe('§4.4 — settlementDestinations replaces stripeExternalAccountId', () => {
  it('stripeExternalAccountId no longer exists', () => {
    expect(BANK_ACCOUNT_FIELDS.stripeExternalAccountId).toBeUndefined()
  })

  it('is a TAGS field carrying bank_account_settlement_destinations', () => {
    const field = BANK_ACCOUNT_FIELDS.settlementDestinations
    expect(field?.fieldType).toBe('TAGS')
    expect(field?.systemAttribute).toBe('bank_account_settlement_destinations')
    expect(field?.nullable).toBe(true)
  })
})

describe('§4.5 — payout.destinationMismatch', () => {
  it('is TEXT, nullable, and distinct from blockedReason', () => {
    const field = PAYOUT_FIELDS.destinationMismatch
    expect(field?.fieldType).toBe('TEXT')
    expect(field?.systemAttribute).toBe('payout_destination_mismatch')
    expect(field?.nullable).toBe(true)
    expect(PAYOUT_FIELDS.blockedReason?.systemAttribute).toBe('payout_blocked_reason')
  })
})

describe('migration 166 up()', () => {
  it('is a no-op for an org short of all three defs', async () => {
    resetStubs()
    existingDefs = []
    const db = makeFakeDb({
      gatewayFieldsFound: [],
      bankInverseFound: [],
      stripeField: null,
      fieldValuesFound: [],
    })

    const result = await runUp(db)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.gatewayFieldsRemoved).toBe(0)
    expect(result.bankInverseFieldRemoved).toBe(false)
    expect(result.bankFieldRetyped).toBe(false)
    expect(result.settlementValuesMigrated).toBe(0)
    expect(ensureCalls).toHaveLength(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('removes the six gateway fields and the bank inverse, retypes the bank field, and widens payout', async () => {
    resetStubs()
    const db = makeFakeDb({
      gatewayFieldsFound: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
      bankInverseFound: ['f7'],
      stripeField: { id: 'stripe_field_1' },
      fieldValuesFound: ['fv1', 'fv2'],
    })

    const result = await runUp(db)

    expect(result.gatewayFieldsRemoved).toBe(6)
    expect(result.bankInverseFieldRemoved).toBe(true)
    expect(result.bankFieldRetyped).toBe(true)
    expect(result.settlementValuesMigrated).toBe(2)
    expect(ensureCalls).toHaveLength(1)
    expect(ensureCalls[0]?.entityType).toBe('payout')
    expect(ensureCalls[0]?.defId).toBe('def_payout')
    expect(ensureCalls[0]?.fieldKeys).toEqual(['destinationMismatch'])
    expect(result.fieldsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a re-run removes nothing, retypes nothing, and adds nothing', async () => {
    resetStubs()
    existingPayoutFieldKeys = ['destinationMismatch']
    const db = makeFakeDb({
      gatewayFieldsFound: [],
      bankInverseFound: [],
      stripeField: null, // the OLD attribute is gone on a re-run — nothing left to find
      fieldValuesFound: [],
    })

    const result = await runUp(db)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.gatewayFieldsRemoved).toBe(0)
    expect(result.bankInverseFieldRemoved).toBe(false)
    expect(result.bankFieldRetyped).toBe(false)
    expect(result.settlementValuesMigrated).toBe(0)
    expect(result.fieldsCreated).toBe(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
