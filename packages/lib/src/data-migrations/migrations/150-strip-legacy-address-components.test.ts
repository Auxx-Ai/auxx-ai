// packages/lib/src/data-migrations/migrations/150-strip-legacy-address-components.test.ts
//
// Migration 150 is one set-based `UPDATE` whose whole matching rule lives in
// SQL (`options -> 'addressComponents' @> '["street"]'`), so a stub `Database`
// cannot evaluate it — the schema's own column objects carry no usable data in
// this environment, the same reason `142-wipe-seeded-charts.test.ts`'s stub
// never interprets a condition either. What is pinned here instead:
//
//  - the five registry address fields no longer SHIP the stale literal, which
//    is the half of this change a migration cannot cover (a registry edit
//    reaches no existing org, and an org edit reaches no fresh one);
//  - the `UPDATE` targets `CustomField` and removes the `addressComponents`
//    key rather than overwriting `options` wholesale — a rewrite would drop
//    `inputMode`, which lives in the same object;
//  - `alreadyUpToDate` tracks whether any row came back, and the org cache is
//    flushed only when one did;
//  - registration in `PER_ORG_MIGRATIONS`.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

// `getOrgCache` is a Redis round trip the stub `Database` below has nothing to
// back — the same reason 142, 143 and 144 stub it.
const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const { migration150StripLegacyAddressComponents } = await import(
  './150-strip-legacy-address-components'
)
const { PER_ORG_MIGRATIONS } = await import('../registry')
const { COMPANY_FIELDS } = await import('../../resources/registry/resources/company-fields')
const { PURCHASE_ORDER_FIELDS } = await import(
  '../../resources/registry/resources/purchase-order-fields'
)
const { ORDER_FIELDS } = await import('../../resources/registry/resources/order-fields')
const { SERVICE_REQUEST_FIELDS } = await import(
  '../../resources/registry/resources/service-request-fields'
)
const { WORK_ORDER_FIELDS } = await import('../../resources/registry/resources/work-order-fields')

const MIGRATION_ID = '150-strip-legacy-address-components'
const ORG = 'org_1'

/**
 * A stub `Database` recording the single `update()` this migration issues and
 * resolving `.returning()` with whatever row set the test wants the statement
 * to have matched.
 */
function stubDb(matched: { id: string }[]) {
  const updates: { table: unknown; set: Record<string, unknown> }[] = []
  const db = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, set: values })
        return { where: () => ({ returning: async () => matched }) }
      },
    }),
  }
  return { db: db as unknown as Database, updates }
}

describe('migration 150 registration', () => {
  it('is registered in PER_ORG_MIGRATIONS', () => {
    expect(PER_ORG_MIGRATIONS.map((m) => m.id)).toContain(MIGRATION_ID)
  })

  it('has the id the module exports', () => {
    expect(migration150StripLegacyAddressComponents.id).toBe(MIGRATION_ID)
  })
})

describe('the registry no longer ships the pre-editor list', () => {
  // The five fields the guard in `address-component-editor.tsx` was written
  // for. A fresh org must not be handed the stale list again, or this
  // migration would have to run forever.
  const ADDRESS_FIELDS = [
    ['company.headquarters', COMPANY_FIELDS.headquarters],
    ['purchase_order.shipTo', PURCHASE_ORDER_FIELDS.shipTo],
    ['order.shippingAddress', ORDER_FIELDS.shippingAddress],
    ['service_request.serviceAddress', SERVICE_REQUEST_FIELDS.serviceAddress],
    ['work_order.serviceAddress', WORK_ORDER_FIELDS.serviceAddress],
  ] as const

  it.each(ADDRESS_FIELDS)('%s declares no addressComponents', (_name, field) => {
    expect(field).toBeDefined()
    const options = field?.options as { addressComponents?: unknown } | undefined
    expect(options?.addressComponents).toBeUndefined()
  })

  it('no registry field anywhere still names the impossible `street` id', () => {
    const allFields = [
      ...Object.values(COMPANY_FIELDS),
      ...Object.values(PURCHASE_ORDER_FIELDS),
      ...Object.values(ORDER_FIELDS),
      ...Object.values(SERVICE_REQUEST_FIELDS),
      ...Object.values(WORK_ORDER_FIELDS),
    ]
    const offenders = allFields.filter((f) => {
      const components = (f.options as { addressComponents?: unknown } | undefined)
        ?.addressComponents
      return Array.isArray(components) && components.includes('street')
    })
    expect(offenders).toEqual([])
  })
})

describe('migration 150 up()', () => {
  it('reports alreadyUpToDate and flushes nothing when no row matched', async () => {
    invalidateAndRecompute.mockClear()
    const { db, updates } = stubDb([])

    const result = await migration150StripLegacyAddressComponents.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsCreated).toBe(0)
    expect(updates).toHaveLength(1)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('reports work done and flushes the field caches when rows matched', async () => {
    invalidateAndRecompute.mockClear()
    const { db } = stubDb([{ id: 'cf_1' }, { id: 'cf_2' }])

    const result = await migration150StripLegacyAddressComponents.up(db, ORG)

    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('updates CustomField, removing the key rather than overwriting options', async () => {
    const { db, updates } = stubDb([{ id: 'cf_1' }])

    await migration150StripLegacyAddressComponents.up(db, ORG)

    expect(updates[0]?.table).toBe(schema.CustomField)
    // `inputMode` lives in the same jsonb object, so the statement must subtract
    // one key, never assign a fresh object.
    const rendered = JSON.stringify(updates[0]?.set.options)
    expect(rendered).toContain('addressComponents')
    expect(updates[0]?.set.options).not.toBeInstanceOf(Array)
    expect(typeof updates[0]?.set.options).toBe('object')
    expect(updates[0]?.set.updatedAt).toBeInstanceOf(Date)
  })
})
