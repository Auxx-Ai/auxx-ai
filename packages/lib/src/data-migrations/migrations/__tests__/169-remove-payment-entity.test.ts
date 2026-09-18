// packages/lib/src/data-migrations/migrations/__tests__/169-remove-payment-entity.test.ts
//
// Three independent pieces, so what goes wrong is per-piece, not shared:
//
//  - the two relationships must be gone from the REGISTRY, or a fresh org
//    keeps seeding what follow-up 9 retires;
//  - `payment` must be gone from `SYSTEM_ENTITIES`, so a fresh org never seeds
//    the def at all;
//  - an org short of a def is a SKIP on that piece alone, never a throw;
//  - a re-run finds nothing left to remove or archive on an org that already
//    took this migration once.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import type { Migration169Result } from '../169-remove-payment-entity'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['invoice', 'bank_deposit', 'payment']

vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
}))

const { migration169RemovePaymentEntity } = await import('../169-remove-payment-entity')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { SYSTEM_ENTITIES } = await import('../../../seed/entity-seeder/constants')
const { INVOICE_FIELDS } = await import('../../../resources/registry/resources/invoice-fields')
const { BANK_DEPOSIT_FIELDS } = await import(
  '../../../resources/registry/resources/bank-deposit-fields'
)

const MIGRATION_ID = '169-remove-payment-entity'
const ORG = 'org_1'

/** `PerOrgMigration.up` narrows the return type to the shared interface; this restores the richer one for assertions. */
const runUp = (db: Database) =>
  migration169RemovePaymentEntity.up(db, ORG) as unknown as Promise<Migration169Result>

function resetStubs() {
  existingDefs = ['invoice', 'bank_deposit', 'payment']
  invalidateAndRecompute.mockClear()
}

/**
 * A database that answers each successive `delete`/`update` with the ids
 * `.returning()` should report, in call order: the two `CustomField` deletes
 * (invoice, then bank_deposit), then the def archive, then the instance
 * archive - the order `up()` issues them in.
 */
function fakeDb(script: {
  customFieldDeletes?: string[][]
  defArchives?: string[]
  instanceArchives?: string[]
}) {
  const deletes = [...(script.customFieldDeletes ?? [])]
  const updates = [script.defArchives ?? [], script.instanceArchives ?? []]
  const db = {
    delete: () => ({
      where: () => ({
        returning: async () => (deletes.shift() ?? []).map((id) => ({ id })),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => (updates.shift() ?? []).map((id) => ({ id })),
        }),
      }),
    }),
  }
  return db as unknown as Database
}

describe('migration 169 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration169RemovePaymentEntity.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 169', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '169')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('reaches the shared registry sorted after 168', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf('168-remove-gl-posting-stamp-fields')
    )
  })
})

describe('payment is gone from the registries', () => {
  it('is not a system entity anymore', () => {
    expect(SYSTEM_ENTITIES.map((e) => e.entityType)).not.toContain('payment')
  })

  it('invoice no longer declares a payments relationship', () => {
    expect(INVOICE_FIELDS.payments).toBeUndefined()
  })

  it('bank_deposit no longer declares a payments relationship', () => {
    expect(BANK_DEPOSIT_FIELDS.payments).toBeUndefined()
  })
})

describe('migration 169 up()', () => {
  it('is a no-op for an org with none of the three pieces', async () => {
    resetStubs()
    existingDefs = []
    const db = fakeDb({})

    const result = await runUp(db)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.relationshipsRemoved).toBe(0)
    expect(result.paymentDefArchived).toBe(false)
    expect(result.instancesArchived).toBe(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('removes both relationships and archives the def and its instances', async () => {
    resetStubs()
    const db = fakeDb({
      customFieldDeletes: [['field_invoice_payments'], ['field_bank_deposit_payments']],
      defArchives: ['def_payment'],
      instanceArchives: ['pay_1', 'pay_2'],
    })

    const result = await runUp(db)

    expect(result.relationshipsRemoved).toBe(2)
    expect(result.paymentDefArchived).toBe(true)
    expect(result.instancesArchived).toBe(2)
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, [
      'customFields',
      'resources',
      'entityDefs',
      'entityDefSlugs',
    ])
  })

  it('skips a relationship whose def the org never seeded, without throwing', async () => {
    resetStubs()
    existingDefs = ['bank_deposit', 'payment']
    const db = fakeDb({
      customFieldDeletes: [['field_bank_deposit_payments']],
      defArchives: ['def_payment'],
      instanceArchives: [],
    })

    const result = await runUp(db)

    expect(result.relationshipsRemoved).toBe(1)
    expect(result.paymentDefArchived).toBe(true)
  })

  it('is idempotent: a re-run finds nothing left to remove or archive', async () => {
    resetStubs()
    const db = fakeDb({ customFieldDeletes: [[], []], defArchives: [], instanceArchives: [] })

    const result = await runUp(db)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.relationshipsRemoved).toBe(0)
    expect(result.paymentDefArchived).toBe(false)
    expect(result.instancesArchived).toBe(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('is a no-op on payment alone when the org never had it (fresh install)', async () => {
    resetStubs()
    existingDefs = ['invoice', 'bank_deposit']
    const db = fakeDb({ customFieldDeletes: [[], []] })

    const result = await runUp(db)

    expect(result.paymentDefArchived).toBe(false)
    expect(result.instancesArchived).toBe(0)
  })
})
