// packages/lib/src/seed/entity-migrations/migrations/108-purchasing.test.ts
//
// Migration 108 is helper composition (the 101/103/107 recipe), so the wiring is
// what is pinned here: eight new entity types touch ten hand-edited registries
// each, and a miss in any one of them is a no-op rather than an error, while
// `linkNewRelationships` resolves inverse pairs by string reference, so a typo
// in either direction links nothing and logs a debug line.
//
// Two blocks are different in kind.
//
// `every relationship half resolves in the single linking pass` is the property
// the merge exists to buy. The old 108 -> 109 -> 110 sequence had to leave edges
// dangling and close them a migration later, because the linker links what is in
// the FIELD MAP, not what is in the database. With all eight defs created in one
// pass there is nothing left over, and that is asserted twice: statically
// (every inverse reference names a key the migration materialises) and
// dynamically (the migration links exactly as many edges as it declares).
//
// The P13 block asserts INERTNESS against the source tree. `vendor_payment` and
// `vendor_payment_allocation` ship with zero rows and no writer, and that is a
// claim about the whole tree that no amount of commenting can keep true.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Database, schema } from '@auxx/database'
import { FieldType, ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
import { isSystemAttribute } from '@auxx/types/system-attribute'
import { describe, expect, it, vi } from 'vitest'
import {
  GlAccountType,
  GlPostingLineDirection,
  LandedCostAllocationBasis,
  PurchaseOrderBillingStatus,
  PurchaseOrderReceiptStatus,
  PurchaseOrderStatus,
  StockMovementCostBasis,
  VendorBillPaidSource,
  VendorBillStatus,
  VendorPaymentStatus,
} from '../../../resources/registry/enum-values'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import type { FieldOptionItem } from '../../../resources/registry/option-helpers'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { GL_ACCOUNT_FIELDS } from '../../../resources/registry/resources/gl-account-fields'
import { GL_POSTING_FIELDS } from '../../../resources/registry/resources/gl-posting-fields'
import { GL_POSTING_LINE_FIELDS } from '../../../resources/registry/resources/gl-posting-line-fields'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { PURCHASE_ORDER_FIELDS } from '../../../resources/registry/resources/purchase-order-fields'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../../resources/registry/resources/purchase-order-line-fields'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../../resources/registry/resources/stock-movement-fields'
import { VENDOR_BILL_FIELDS } from '../../../resources/registry/resources/vendor-bill-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../../resources/registry/resources/vendor-bill-line-fields'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { VENDOR_PAYMENT_ALLOCATION_FIELDS } from '../../../resources/registry/resources/vendor-payment-allocation-fields'
import { VENDOR_PAYMENT_FIELDS } from '../../../resources/registry/resources/vendor-payment-fields'
import { DEFAULT_VIEW_CONFIGS } from '../../default-view-configs'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import {
  DISPLAY_FIELD_CONFIG,
  ENTITY_INSTANCE_COLUMNS,
  SYSTEM_ENTITIES,
} from '../../entity-seeder/constants'
import { FIELD_REGISTRY } from '../../entity-seeder/create-fields'
import { shouldCreateField } from '../../entity-seeder/utils'
import { migration108Purchasing } from './108-purchasing'

// The migration resolves the org's system user to own the seeded views. That is
// a Redis + prepared-statement round trip and has nothing to do with what these
// tests assert, so it is stubbed rather than reached.
vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'system-user-1' },
}))

// Same reason for the org cache: `up()` drops the per-org entity/field caches
// when it changed something, which is a Redis round trip. Only `getOrgCache` is
// replaced — the rest of the barrel is left as-is, because `helpers.ts` reaches
// into it for `onCacheEvent`.
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute: async () => {} }),
}))

/** The eight defs this migration creates. */
const NEW_TYPES = [
  'purchase_order',
  'purchase_order_line',
  'vendor_bill',
  'vendor_bill_line',
  'vendor_payment',
  'vendor_payment_allocation',
  'gl_account',
  'gl_posting_line',
] as const

const NEW_REGISTRIES: Record<(typeof NEW_TYPES)[number], Record<string, ResourceField>> = {
  purchase_order: PURCHASE_ORDER_FIELDS,
  purchase_order_line: PURCHASE_ORDER_LINE_FIELDS,
  vendor_bill: VENDOR_BILL_FIELDS,
  vendor_bill_line: VENDOR_BILL_LINE_FIELDS,
  vendor_payment: VENDOR_PAYMENT_FIELDS,
  vendor_payment_allocation: VENDOR_PAYMENT_ALLOCATION_FIELDS,
  gl_account: GL_ACCOUNT_FIELDS,
  gl_posting_line: GL_POSTING_LINE_FIELDS,
}

/** The ten fields of plans/purchasing/01-build-plan.md §2.1, in plan order. */
const RECEIVING_KEYS = [
  'unitCost',
  'extendedCost',
  'costBasis',
  'glAccount',
  'occurredAt',
  'vendorPart',
  'vendorUnitPrice',
  'purchaseOrderLine',
  'reversesMovement',
  'reversedByMovements',
] as const

/**
 * The fields the migration hangs off defs it does not create. Declared again
 * here on purpose: the two lists have to agree, and this is what says so.
 *
 * All are inverse halves except `part.unit` — the stock unit of measure, added
 * here because the purchasing lines are the first surface that renders one.
 */
const INVERSE_KEYS: Record<string, readonly string[]> = {
  company: ['purchaseOrders', 'vendorBills', 'vendorPayments'],
  contact: ['purchaseOrders'],
  part: ['purchaseOrderLines', 'vendorBillLines', 'unit'],
  vendor_part: ['stockMovements', 'purchaseOrderLines'],
  gl_posting: ['lines'],
}

const INCUMBENT_REGISTRIES: Record<string, Record<string, ResourceField>> = {
  stock_movement: STOCK_MOVEMENT_FIELDS,
  company: COMPANY_FIELDS,
  contact: CONTACT_FIELDS,
  part: PART_FIELDS,
  vendor_part: VENDOR_PART_FIELDS,
  gl_posting: GL_POSTING_FIELDS,
}

/**
 * The `${entityType}:${field.id}` keys `up()` puts into the map it hands
 * `linkNewRelationships` — the same selection and the same `shouldCreateField`
 * filter `ensureCustomFields` applies, so a key missing here is a key missing
 * there.
 */
function materialisedFields(): Map<string, ResourceField> {
  const map = new Map<string, ResourceField>()
  const add = (
    entityType: string,
    registry: Record<string, ResourceField>,
    keys?: readonly string[]
  ) => {
    for (const [key, field] of Object.entries(registry)) {
      if (keys && !keys.includes(key)) continue
      if (!shouldCreateField(field, ENTITY_INSTANCE_COLUMNS)) continue
      map.set(`${entityType}:${field.id}`, field)
    }
  }

  for (const entityType of NEW_TYPES) add(entityType, NEW_REGISTRIES[entityType])
  add('stock_movement', STOCK_MOVEMENT_FIELDS, RECEIVING_KEYS)
  for (const [entityType, keys] of Object.entries(INVERSE_KEYS)) {
    add(entityType, INCUMBENT_REGISTRIES[entityType]!, keys)
  }
  return map
}

/**
 * The eleven `ICON_COLORS` ids `EntityDefinition.color` may hold.
 *
 * This list is the REAL one and must stay that way. An id outside it is not an
 * error anywhere — `getIconColor` is
 * `ICON_COLORS.find((c) => c.id === colorId) ?? ICON_COLORS[0]`, so an unknown
 * colour silently renders gray. That is the same failure mode as an unknown
 * ICON id, which is how `product` reached 28 orgs with no glyph.
 *
 * ⚠️ Do NOT widen this to make a failing entity pass. `slate` and `rose` were
 * added here for exactly that reason during the build and both are removed:
 * `purchase_order*` is `teal` and `vendor_bill*` is `red`, which are real.
 *
 * Note this is NOT the same union as `SELECT_OPTION_COLORS`
 * (`@auxx/types/custom-field`), which has `forest` where this has `emerald`.
 * Two lists, two spellings, and a value valid in one is not valid in the other.
 *
 * `@auxx/lib` is tier 3 and must never import `@auxx/ui`, so this is a
 * transcription. The cross-package check that would keep it honest
 * automatically does not exist yet.
 */
const VALID_COLORS = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'emerald',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
]

// ─────────────────────────────────────────────────────────────────────────────
// The stub `Database`.
//
// The maintenance job runs every migration against every org on every boot, so
// a second `up()` over an already-migrated org must write nothing at all. That
// claim is cheap to make and expensive to be wrong about, so it is checked
// against a stub that answers "everything already exists" and records any write
// it is asked to perform. The stub deliberately ignores WHERE clauses — it does
// not need to evaluate Drizzle conditions to answer that question, and the real
// SQL behaviour belongs in an integration test, not here.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_NAMES = new Map<unknown, string>([
  [schema.EntityDefinition, 'EntityDefinition'],
  [schema.CustomField, 'CustomField'],
  [schema.TableView, 'TableView'],
])

/**
 * One already-materialised CustomField row per registry field.
 *
 * `linked` controls whether the row already carries an `inverseResourceFieldId`:
 * `true` makes `linkNewRelationships` treat every pair as resolved (the
 * idempotency case), `false` leaves them open so the linker actually runs (the
 * one-pass linking case).
 */
function fieldRows(
  entityDefinitionId: string,
  registry: Record<string, ResourceField>,
  linked = true
) {
  return Object.values(registry)
    .filter((f) => f.systemAttribute)
    .map((f) => ({
      id: `field-${entityDefinitionId}-${f.systemAttribute}`,
      systemAttribute: f.systemAttribute!,
      entityDefinitionId,
      options: {
        ...(linked ? { relationship: { inverseResourceFieldId: 'already:linked' } } : {}),
        // Carry the registry's SELECT options through. Without them every
        // already-migrated select field looks stale to the option-refresh step,
        // and the idempotency case reports a rewrite that a real database would
        // not perform.
        ...(f.options?.options ? { options: f.options.options } : {}),
      },
    }))
}

function stubDb(rowsByTable: Map<unknown, unknown[]>, writes: string[]) {
  const chain = (rows: unknown[]): Record<string, unknown> => ({
    where: () => chain(rows),
    limit: () => chain(rows),
    orderBy: () => chain(rows),
    // A Drizzle query builder IS a thenable - awaiting it is how it runs.
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable too
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  })
  const name = (table: unknown) => TABLE_NAMES.get(table) ?? 'unknown'

  return {
    select: () => ({ from: (table: unknown) => chain(rowsByTable.get(table) ?? []) }),
    insert: (table: unknown) => ({
      values: () => ({
        returning: async () => {
          writes.push(`insert ${name(table)}`)
          return [{ id: 'unexpected-insert', options: {} }]
        },
        // `ensureFieldViews` awaits `.values()` directly, with no `.returning()`.
        // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable too
        then: (resolve: (v: unknown) => unknown) => {
          writes.push(`insert ${name(table)}`)
          return Promise.resolve(undefined).then(resolve)
        },
      }),
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: async () => {
          writes.push(`update ${name(table)}`)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        writes.push(`delete ${name(table)}`)
      },
    }),
  } as unknown as Database
}

/** Every def the migration touches, already materialised. */
const ALL_DEF_REGISTRIES: Record<string, Record<string, ResourceField>> = {
  ...NEW_REGISTRIES,
  ...INCUMBENT_REGISTRIES,
}

/**
 * The two ways a stored option list goes stale, one per direction:
 *
 *   vendor_bill_status     a value was ADDED to the enum (`partially_paid`)
 *   purchase_order_status  two values were REMOVED (they became their own fields)
 *
 * Both are invisible to `ensureCustomFields`, which skips a field that already
 * exists — which is the whole reason the refresh step exists.
 */
const STALE_STATUS_FIXTURES: Record<
  'vendor_bill_status' | 'purchase_order_status',
  FieldOptionItem[]
> = {
  vendor_bill_status: VendorBillStatus.values.filter((v) => v.value !== 'partially_paid'),
  purchase_order_status: [
    ...PurchaseOrderStatus.values.slice(0, 2),
    { value: 'partially_received', label: 'Partially received', color: 'amber' },
    { value: 'received', label: 'Received', color: 'green' },
    ...PurchaseOrderStatus.values.slice(2),
  ],
}

function migratedOrgDb(
  writes: string[],
  opts: {
    linked?: boolean
    omit?: readonly string[]
    staleStatus?: keyof typeof STALE_STATUS_FIXTURES
  } = {}
) {
  const omit = new Set(opts.omit ?? [])
  const defs = Object.entries(ALL_DEF_REGISTRIES).filter(([entityType]) => !omit.has(entityType))
  const customFields = defs.flatMap(([entityType, registry]) =>
    fieldRows(`def-${entityType}`, registry, opts.linked ?? true)
  )

  // An org migrated BEFORE the enum changed: the row still carries the option
  // list it was created with.
  if (opts.staleStatus) {
    const statusRow = customFields.find((row) => row.systemAttribute === opts.staleStatus)
    if (!statusRow) throw new Error(`fixture: ${opts.staleStatus} row is missing`)
    statusRow.options = {
      ...statusRow.options,
      options: STALE_STATUS_FIXTURES[opts.staleStatus],
    }
  }

  return stubDb(
    new Map<unknown, unknown[]>([
      [
        schema.EntityDefinition,
        defs.map(([entityType]) => ({ id: `def-${entityType}`, entityType })),
      ],
      [schema.CustomField, customFields],
      // A view already exists for every context, so both view helpers no-op.
      [schema.TableView, [{ id: 'view-1' }]],
    ]),
    writes
  )
}

// ─── Identity ────────────────────────────────────────────────────────────────

describe('migration 108 identity', () => {
  // The id is the ledger key: once a migration has run anywhere, changing it
  // re-applies the whole thing under a new name. It must match the filename so
  // a reader can find the code from a `MigrationLedger` row.
  it('declares an id matching its filename', () => {
    expect(migration108Purchasing.id).toBe('108-purchasing')
  })

  // Order matters: `runEntityMigrationsForOrg` walks this array in sequence and
  // stops the org on the first failure. The uniqueness check is not decoration
  // either - the id space is shared with `data-migrations/migrations/` and has
  // collided once already, at 103.
  it('is registered exactly once, immediately after 107-order, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '108-purchasing')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('108-purchasing')).toBe(ids.indexOf('107-order') + 1)
  })
})

// ─── The ten receiving fields on stock_movement (§2) ─────────────────────────

describe('the ten receiving fields', () => {
  it('all exist on STOCK_MOVEMENT_FIELDS', () => {
    for (const key of RECEIVING_KEYS) {
      expect(STOCK_MOVEMENT_FIELDS[key], `STOCK_MOVEMENT_FIELDS.${key} is missing`).toBeDefined()
    }
  })

  it('every systemAttribute is in the SystemAttribute union', () => {
    for (const [key, field] of Object.entries(STOCK_MOVEMENT_FIELDS)) {
      expect(field.systemAttribute, `${key} has no systemAttribute`).toBeTruthy()
      expect(
        isSystemAttribute(field.systemAttribute!),
        `${key}: '${field.systemAttribute}' missing from @auxx/types/system-attribute`
      ).toBe(true)
    }
  })

  it('every systemAttribute is namespaced to this entity, so no other def collides', () => {
    for (const key of RECEIVING_KEYS) {
      expect(STOCK_MOVEMENT_FIELDS[key]?.systemAttribute, key).toMatch(/^stock_movement_/)
    }
  })

  // Not decoration: an immutable ledger is the whole reason a frozen cost can
  // be trusted three years later. Every pre-existing field on this entity is
  // non-updatable and these must not be the exception.
  it('are all non-updatable — the movement ledger is append-only', () => {
    for (const key of RECEIVING_KEYS) {
      expect(STOCK_MOVEMENT_FIELDS[key]?.capabilities?.updatable, key).toBe(false)
      expect(STOCK_MOVEMENT_FIELDS[key]?.capabilities?.configurable, key).toBe(false)
    }
  })

  it('the money fields are CURRENCY, in integer minor units', () => {
    for (const key of ['unitCost', 'extendedCost', 'vendorUnitPrice'] as const) {
      expect(STOCK_MOVEMENT_FIELDS[key]?.fieldType, key).toBe(FieldType.CURRENCY)
    }
  })

  // §2.2: `createdAt` records when the row was TYPED. The pallet lands Thursday
  // and the paperwork is keyed Monday, so without a separate accounting date
  // every period boundary falls on the wrong side.
  it('occurredAt is a real DATETIME field, distinct from createdAt', () => {
    expect(STOCK_MOVEMENT_FIELDS.occurredAt?.fieldType).toBe(FieldType.DATETIME)
    expect(STOCK_MOVEMENT_FIELDS.occurredAt?.systemAttribute).toBe('stock_movement_occurred_at')
    expect(STOCK_MOVEMENT_FIELDS.occurredAt?.systemAttribute).not.toBe(
      STOCK_MOVEMENT_FIELDS.createdAt?.systemAttribute
    )
  })

  // P2: the ledger's own key is the account CODE. A provider's id for an
  // account belongs on an app-owned identity field, never in a stored value -
  // otherwise the subledger is only as portable as the vendor that holds it.
  it('glAccount is a TEXT account code, not a relation to a provider id', () => {
    expect(STOCK_MOVEMENT_FIELDS.glAccount?.fieldType).toBe(FieldType.TEXT)
    expect(STOCK_MOVEMENT_FIELDS.glAccount?.systemAttribute).toBe('stock_movement_gl_account')
  })

  it('costBasis offers exactly standard | actual, wired to the enum list', () => {
    expect(StockMovementCostBasis.values.map((v) => v.value)).toEqual(['standard', 'actual'])
    expect(STOCK_MOVEMENT_FIELDS.costBasis?.options).toEqual({
      options: StockMovementCostBasis.values,
    })
  })

  // §2.2: `parentMovement` means "parent of a BOM explosion" and
  // `explodeBomMovement` reads it. A reversal hung off it would land in
  // `childMovements` and corrupt the explosion's own bookkeeping.
  it('reversal is a SECOND self-relation, never an overload of parentMovement', () => {
    expect(STOCK_MOVEMENT_FIELDS.reversesMovement?.systemAttribute).toBe(
      'stock_movement_reverses_movement'
    )
    expect(STOCK_MOVEMENT_FIELDS.reversesMovement?.systemAttribute).not.toBe(
      STOCK_MOVEMENT_FIELDS.parentMovement?.systemAttribute
    )
    expect(STOCK_MOVEMENT_FIELDS.reversesMovement?.relationshipConfig).toMatchObject({
      relatedEntityType: 'stock_movement',
      relationshipType: 'belongs_to',
      inverseSystemAttribute: 'stock_movement_reversed_by_movements',
    })
    expect(STOCK_MOVEMENT_FIELDS.reversedByMovements?.relationshipConfig).toMatchObject({
      relatedEntityType: 'stock_movement',
      relationshipType: 'has_many',
      inverseSystemAttribute: 'stock_movement_reverses_movement',
    })
  })

  // The self-relations carry `relationshipConfig` but NO
  // `relationship.inverseResourceFieldId`, exactly like the existing
  // parentMovement/childMovements pair. `linkNewRelationships` requires the
  // latter, so it skips them by design and the seeder materialises them from
  // `relationshipConfig`. Pinned so nobody "fixes" one half into the other.
  it('the self-relations are linked from relationshipConfig, not by the linker', () => {
    for (const key of ['reversesMovement', 'reversedByMovements', 'parentMovement'] as const) {
      expect(STOCK_MOVEMENT_FIELDS[key]?.relationship, key).toBeUndefined()
      expect(STOCK_MOVEMENT_FIELDS[key]?.relationshipConfig, key).toBeDefined()
    }
  })

  // §2.5. Existing movements keep NULL cost and NULL occurredAt and stay that
  // way: they are not postable, and the fix is the opening entry. Reconstructing
  // a past movement's cost from a later ledger state is the exact failure mode
  // that rewrote a competitor's completed build from $14.29 to $81.25.
  it('makes no backfill claim', () => {
    expect(migration108Purchasing.description).toContain('stock_movement')
    expect(migration108Purchasing.description.toLowerCase()).not.toContain('backfill')
  })
})

// ─── Registration wiring for the eight new defs ──────────────────────────────

describe('the eight entity registrations', () => {
  it('every systemAttribute on every new registry is in the SystemAttribute union', () => {
    for (const [entityType, fields] of Object.entries(NEW_REGISTRIES)) {
      for (const [key, field] of Object.entries(fields)) {
        expect(field.systemAttribute, `${entityType}.${key} has no systemAttribute`).toBeTruthy()
        expect(
          isSystemAttribute(field.systemAttribute!),
          `${entityType}.${key}: '${field.systemAttribute}' missing from @auxx/types/system-attribute`
        ).toBe(true)
      }
    }
  })

  it('all eight are registered in every registry the seeder reads', () => {
    for (const entityType of NEW_TYPES) {
      expect(RESOURCE_FIELD_REGISTRY[entityType]).toBe(NEW_REGISTRIES[entityType])
      expect(FIELD_REGISTRY[entityType]).toBe(NEW_REGISTRIES[entityType])
      expect(ModelTypeValues).toContain(entityType)
      expect(SYSTEM_ENTITIES.find((e) => e.entityType === entityType)).toBeDefined()
    }
  })

  // §4.4: a PO is built, issued and received against - that is page-shaped.
  // Its line entity is hidden and managed from the PO, the `subpart` /
  // `vendor_part` precedent.
  it('the PO has a detail page and the line does not', () => {
    expect(ModelTypeMeta.purchase_order).toEqual({
      label: 'Purchase Order',
      plural: 'Purchase Orders',
      icon: 'shopping-cart',
      color: 'teal',
      apiSlug: 'purchase-orders',
      dbTable: 'EntityInstance',
      hasDetailPage: true,
    })
    expect(ModelTypeMeta.purchase_order_line.hasDetailPage).toBe(false)
    expect(SYSTEM_ENTITIES.find((e) => e.entityType === 'purchase_order')?.isVisible).toBe(true)
    expect(SYSTEM_ENTITIES.find((e) => e.entityType === 'purchase_order_line')?.isVisible).toBe(
      false
    )
  })

  // §5.1: the `invoice` shape. A bill RECORDS something already settled; it is
  // not built or iterated, so it is drawer-only and the exception queue is a
  // filtered list view rather than a page per bill.
  it('vendor_bill is a visible, drawer-only entity and its line is hidden', () => {
    expect(SYSTEM_ENTITIES.find((e) => e.entityType === 'vendor_bill')!.isVisible).toBe(true)
    expect(SYSTEM_ENTITIES.find((e) => e.entityType === 'vendor_bill_line')!.isVisible).toBe(false)
    expect(ModelTypeMeta.vendor_bill.hasDetailPage).toBe(false)
  })

  // §7.2/§7.3: both GL defs and both payment defs are written only by machinery,
  // like `gl_posting` itself. That is why the migration seeds them no field
  // views and no saved table views - a hidden entity with no panel and no detail
  // page has nothing to render them into.
  it('the payment pair and both GL defs are hidden, page-less and view-less', () => {
    for (const entityType of [
      'vendor_payment',
      'vendor_payment_allocation',
      'gl_account',
      'gl_posting_line',
    ] as const) {
      expect(SYSTEM_ENTITIES.find((e) => e.entityType === entityType)?.isVisible, entityType).toBe(
        false
      )
      expect(ModelTypeMeta[entityType].hasDetailPage, entityType).toBe(false)
      expect(DEFAULT_VIEW_CONFIGS).not.toHaveProperty(entityType)
    }
  })

  // NOTE: the real check - "does this id exist in @auxx/ui's ICON_DATA?" -
  // cannot live here. `@auxx/lib` is tier 3 and must never import `@auxx/ui`. A
  // cross-package test in apps/web is what would catch a bad id, and it still
  // does not exist.
  it('SYSTEM_ENTITIES and ModelTypeMeta agree on icon, colour and slug', () => {
    for (const entityType of NEW_TYPES) {
      const entity = SYSTEM_ENTITIES.find((e) => e.entityType === entityType)!
      expect(ModelTypeMeta[entityType].icon).toBe(entity.icon)
      expect(ModelTypeMeta[entityType].color).toBe(entity.color)
      expect(ModelTypeMeta[entityType].apiSlug).toBe(entity.apiSlug)
      expect(VALID_COLORS, entityType).toContain(entity.color)
    }
  })

  it('display fields resolve against real registry keys', () => {
    for (const entityType of NEW_TYPES) {
      const config = DISPLAY_FIELD_CONFIG[entityType]
      expect(config, `${entityType} has no DISPLAY_FIELD_CONFIG entry`).toBeDefined()
      for (const key of [config!.primaryDisplayField, config!.secondaryDisplayField]) {
        if (!key) continue
        expect(
          NEW_REGISTRIES[entityType][key],
          `${entityType} display field '${key}' is not a registry key`
        ).toBeDefined()
      }
    }
  })

  // `ensureDefaultTableViews` resolves `field_<systemAttribute>` symbols against
  // the field map it is handed. A column naming an attribute the registry does
  // not have resolves to nothing and the saved view quietly loses that column -
  // which for the "Match Exceptions" queue would mean a review screen with the
  // variance column missing.
  it('the seeded table views only name attributes that exist', () => {
    for (const [entityType, fields] of [
      ['purchase_order', PURCHASE_ORDER_FIELDS],
      ['vendor_bill', VENDOR_BILL_FIELDS],
    ] as const) {
      const attrs = new Set(Object.values(fields).map((f) => f.systemAttribute))
      for (const view of DEFAULT_VIEW_CONFIGS[entityType]) {
        for (const column of view.config.columnOrder ?? []) {
          if (!column.startsWith('field_')) continue
          expect(attrs, `${view.name} names unknown column '${column}'`).toContain(
            column.slice('field_'.length)
          )
        }
      }
    }
    expect(DEFAULT_VIEW_CONFIGS.vendor_bill.map((v) => v.name)).toContain('Match Exceptions')
  })
})

// ─── Field shapes the plan is explicit about ─────────────────────────────────

describe('purchase_order field shapes the plan is explicit about', () => {
  // §4.1: `number` is RecordSequence-issued with prefix PO, so the hook is the
  // only writer. Offering it in the create dialog would be a box nobody may fill.
  it('number is sequence-issued, never user-written', () => {
    expect(PURCHASE_ORDER_FIELDS.number?.systemAttribute).toBe('purchase_order_number')
    expect(PURCHASE_ORDER_FIELDS.number?.capabilities?.creatable).toBe(false)
    expect(PURCHASE_ORDER_FIELDS.number?.capabilities?.updatable).toBe(false)
  })

  // §5.2 of the order plan, house convention: every system entity that has an
  // address uses ADDRESS_STRUCT. Not one registry field uses the bare type.
  it('shipTo is ADDRESS_STRUCT, not the bare ADDRESS type', () => {
    expect(PURCHASE_ORDER_FIELDS.shipTo?.fieldType).toBe(FieldType.ADDRESS_STRUCT)
    expect(PURCHASE_ORDER_FIELDS.shipTo?.fieldType).not.toBe(FieldType.ADDRESS)
  })

  it('subtotal and total are CURRENCY and computed, never typed', () => {
    for (const key of ['subtotal', 'total'] as const) {
      expect(PURCHASE_ORDER_FIELDS[key]?.fieldType, key).toBe(FieldType.CURRENCY)
      expect(PURCHASE_ORDER_FIELDS[key]?.capabilities?.creatable, key).toBe(false)
      expect(PURCHASE_ORDER_FIELDS[key]?.capabilities?.updatable, key).toBe(false)
    }
  })

  // §4.1 / §4.3. These five ARE `allocateLandedCost`'s argument list - which is
  // the entire reason receiving needs no separate `goods_receipt` header. If one
  // of them goes missing the allocation loses a term silently.
  it('carries the whole freight-allocation argument list on the header', () => {
    for (const key of [
      'shippingTotal',
      'taxTotal',
      'discountValue',
      'allocationBasis',
      'taxRecoverable',
    ] as const) {
      expect(PURCHASE_ORDER_FIELDS[key], `header is missing ${key}`).toBeDefined()
    }
    expect(LandedCostAllocationBasis.values.map((v) => v.value)).toEqual([
      'value',
      'quantity',
      'weight',
    ])
    expect(PURCHASE_ORDER_FIELDS.allocationBasis?.options).toEqual({
      options: LandedCostAllocationBasis.values,
    })
  })

  // 07 §3.3. The ACTION axis and only the action axis — four values, all of
  // which a person or the Send action can actually reach.
  it('status is the four-value action lifecycle, wired to the enum list', () => {
    expect(PurchaseOrderStatus.values.map((v) => v.value)).toEqual([
      'draft',
      'issued',
      'closed',
      'canceled',
    ])
    expect(PURCHASE_ORDER_FIELDS.status?.options).toEqual({ options: PurchaseOrderStatus.values })
  })

  // 🛑 The split itself, stated as an assertion rather than a comment. Receiving
  // and billing move independently — a prepaid order is fully billed with
  // nothing received for weeks — so neither may live on `status`, and `status`
  // must not re-acquire them. This is the defect `VendorBillStatus` already has:
  // its payment values overwrite its match verdict and `MATCHABLE_STATUSES` then
  // refuses to recompute it.
  it('keeps receiving and billing off the action axis', () => {
    const actionValues = PurchaseOrderStatus.values.map((v) => v.value)
    for (const leaked of ['partially_received', 'received', 'partially_billed', 'billed']) {
      expect(actionValues, `${leaked} belongs on its own axis`).not.toContain(leaked)
    }

    expect(PurchaseOrderReceiptStatus.values.map((v) => v.value)).toEqual([
      'not_received',
      'partially_received',
      'received',
    ])
    expect(PurchaseOrderBillingStatus.values.map((v) => v.value)).toEqual([
      'not_billed',
      'partially_billed',
      'billed',
    ])
    expect(PURCHASE_ORDER_FIELDS.receiptStatus?.options).toEqual({
      options: PurchaseOrderReceiptStatus.values,
    })
    expect(PURCHASE_ORDER_FIELDS.billingStatus?.options).toEqual({
      options: PurchaseOrderBillingStatus.values,
    })
  })

  // Both are DERIVED: the line roll-up is the only writer, exactly as
  // `quantityReceived` / `quantityBilled` are on the line itself. A creatable
  // derived field is a box a user can fill in and the next roll-up silently
  // overwrites.
  it('receiptStatus and billingStatus are computed, never typed', () => {
    for (const key of ['receiptStatus', 'billingStatus'] as const) {
      const field = PURCHASE_ORDER_FIELDS[key]
      expect(field?.fieldType, key).toBe(FieldType.SINGLE_SELECT)
      expect(field?.isSystem, key).toBe(true)
      expect(field?.capabilities?.creatable, key).toBe(false)
      expect(field?.capabilities?.updatable, key).toBe(false)
      expect(field?.capabilities?.computed, key).toBe(true)
      expect(field?.capabilities?.configurable, key).toBe(false)
      // No `defaultValue`: `applyDefaults` skips non-creatable fields, so one
      // here would be dead code that reads like a guarantee.
      expect(field?.defaultValue, key).toBeUndefined()
    }
  })

  // The three status fields are read together on every PO surface, so they sort
  // together: `a3` (status), `a3a`, `a3b`, then `a4` (orderedAt).
  it('sorts the two derived statuses immediately after status', () => {
    const order = (key: string) => PURCHASE_ORDER_FIELDS[key]?.systemSortOrder
    expect(order('status')).toBe('a3')
    expect(order('receiptStatus')).toBe('a3a')
    expect(order('billingStatus')).toBe('a3b')
    expect(order('orderedAt')).toBe('a4')
    const keys = ['status', 'receiptStatus', 'billingStatus', 'orderedAt'].map(order)
    expect([...keys].sort()).toEqual(keys)
  })

  // 🛑 The pointer `RegisteredDocumentType.pointerAttr` resolves. `ensure-pdf.ts`
  // reads `cf[pointerAttr]` to decide whether to REUSE the last render; with no
  // such field the lookup is `undefined`, `existingAssetId` is always
  // `undefined`, and every send re-renders AND mints a fresh MediaAsset. That
  // leaks an asset per send, throws nothing, and returns a correct PDF every
  // time — so this is asserted rather than trusted.
  //
  // The shape is copied verbatim from the two incumbents because all three go
  // through the same read path: a single FILE value carrying `asset:<MediaAsset
  // id>`, hidden, and neither creatable nor updatable — only `ensureDocumentPdf`
  // writes it, via `FieldValueService`, which does not read the capability at all.
  //
  // 🛑 `updatable: false` is load-bearing here, not cosmetic. It is what stops a
  // person putting their own upload in the slot: `ensureDocumentPdf` appends a
  // new VERSION to whatever asset the pointer names when the content hash
  // disagrees, and a user's file has no hash at all, so the next send would
  // republish it as our PDF (plans/purchasing/08-documents-on-records.md P20).
  it('carries a pdf-asset pointer shaped exactly like the quote and invoice ones', () => {
    const po = PURCHASE_ORDER_FIELDS.pdfAsset
    expect(po?.systemAttribute).toBe('purchase_order_pdf_asset')

    for (const twin of [QUOTE_FIELDS.pdfAsset, INVOICE_FIELDS.pdfAsset]) {
      expect(twin, 'the incumbent pdfAsset field vanished').toBeDefined()
      expect(po?.type).toBe(twin?.type)
      expect(po?.fieldType).toBe(twin?.fieldType)
      expect(po?.nullable).toBe(twin?.nullable)
      expect(po?.showInPanel).toBe(twin?.showInPanel)
      expect(po?.capabilities).toEqual(twin?.capabilities)
    }

    // Spelled out too, so a change to all three at once still trips something.
    expect(po?.fieldType).toBe(FieldType.FILE)
    expect(po?.capabilities?.creatable).toBe(false)
    expect(po?.capabilities?.updatable).toBe(false)
    expect(po?.capabilities?.hidden).toBe(true)
    // Single, and a re-render replaces in place — which is what the pipeline
    // already does (one MediaAsset per document, a new version per change).
    expect(po?.options?.file?.allowMultiple).toBe(false)
    expect(po?.options?.file?.maxFiles).toBe(1)
    // Not a RELATIONSHIP: it stores a MediaAsset ref, and `media_asset` is not
    // an entity def, so a relation would have nothing to link to.
    expect(po?.relationship).toBeUndefined()
    // Late/administrative, where the quote (aK) and invoice (aI) put theirs —
    // after `bills` (aJ) and before the createdAt/updatedAt `b*` block.
    expect(po?.systemSortOrder).toBe('aK')
  })

  // §4.2, and the same rule `part_quantity_on_hand` already lives by: the ledger
  // is the truth, and any hand-maintained copy of a SUM diverges silently.
  it('quantityReceived and quantityBilled are computed, never typed', () => {
    for (const key of ['quantityReceived', 'quantityBilled'] as const) {
      expect(PURCHASE_ORDER_LINE_FIELDS[key]?.capabilities?.creatable, key).toBe(false)
      expect(PURCHASE_ORDER_LINE_FIELDS[key]?.capabilities?.updatable, key).toBe(false)
    }
  })

  it('the line carries a weight, because the weight allocation basis reads it', () => {
    expect(PURCHASE_ORDER_LINE_FIELDS.weight?.systemAttribute).toBe('purchase_order_line_weight')
    expect(PURCHASE_ORDER_LINE_FIELDS.weight?.nullable).toBe(true)
  })
})

describe('vendor_bill field shapes the plan is explicit about', () => {
  // §5.1: `number` is the VENDOR's document, typed by a human;
  // `internalNumber` is ours and RecordSequence-issued. Collapsing the two
  // loses whichever one the other overwrites.
  it('keeps the vendor’s number and our own sequence apart', () => {
    expect(VENDOR_BILL_FIELDS.number?.capabilities?.creatable).toBe(true)
    expect(VENDOR_BILL_FIELDS.internalNumber?.capabilities?.creatable).toBe(false)
    expect(VENDOR_BILL_FIELDS.internalNumber?.capabilities?.updatable).toBe(false)
  })

  it('status is the seven-value bill lifecycle, wired to the enum list', () => {
    expect(VendorBillStatus.values.map((v) => v.value)).toEqual([
      'draft',
      'matched',
      'exception',
      'posted',
      'partially_paid',
      'paid',
      'void',
    ])
    expect(VENDOR_BILL_FIELDS.status?.options).toEqual({ options: VendorBillStatus.values })
  })

  // 🛑 The reason `partially_paid` exists, stated as an assertion rather than a
  // comment: a bill with some of its balance settled must not be able to render
  // as one nobody has touched. Without this value, $400 of $1,000 reads
  // `matched` — identical to $0 of $1,000 — and the only place the difference
  // shows is the payment card.
  it('distinguishes a partly settled bill from an untouched one', () => {
    expect(VendorBillStatus.PARTIALLY_PAID).toBe('partially_paid')
    const values = VendorBillStatus.values.map((v) => v.value)
    expect(values.indexOf('partially_paid')).toBeLessThan(values.indexOf('paid'))
  })

  // `ensureCustomFields` SKIPS an existing field and never touches its options,
  // so an org that already ran 108 keeps whatever option list the field was
  // CREATED with. Changing an enum is therefore only half the change — the
  // migration has to re-materialize the row, or the code and the database
  // disagree about what values exist.
  //
  // The behaviour is asserted for real in the idempotency block below; what is
  // pinned here is that BOTH status fields go through the refresh, and that a
  // refresh counts as work.
  it('re-materializes both status fields rather than only seeding new orgs', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const source = readFileSync(join(here, '108-purchasing.ts'), 'utf8')
    expect(source).toContain('refreshStatusOptions')
    expect(source).toContain('VENDOR_BILL_FIELDS.status')
    expect(source).toContain('PURCHASE_ORDER_FIELDS.status')
    // And the refresh must count toward "did something", or a run that only
    // rewrote options would report alreadyUpToDate and skip the cache flush that
    // makes the change visible to every read path.
    expect(source).toContain('!statusRefreshed')
  })

  // §5.3, and it is the same discipline as the zero-cost receipt guard: never
  // write a value that looks like data when it is a guess. An auto-mark that
  // cannot be told apart from a confirmed payment is how a genuinely unpaid
  // bill goes quiet until the vendor calls.
  it('paidSource distinguishes a confirmed payment from a presumed one', () => {
    expect(VendorBillPaidSource.values.map((v) => v.value)).toEqual([
      'manual',
      'provider',
      'bank_import',
      'rule',
    ])
    expect(VENDOR_BILL_FIELDS.paidSource?.options).toEqual({
      options: VendorBillPaidSource.values,
    })
  })

  it('carries all six payment fields, with balance computed', () => {
    for (const key of [
      'paidAt',
      'amountPaid',
      'balance',
      'paymentMethod',
      'paymentReference',
      'paidSource',
    ] as const) {
      expect(VENDOR_BILL_FIELDS[key], `vendor_bill is missing ${key}`).toBeDefined()
    }
    expect(VENDOR_BILL_FIELDS.balance?.capabilities?.creatable).toBe(false)
    expect(VENDOR_BILL_FIELDS.balance?.capabilities?.updatable).toBe(false)
  })

  it('the match outputs are computed, never typed', () => {
    for (const key of ['matchVariance', 'matchNotes'] as const) {
      expect(VENDOR_BILL_FIELDS[key]?.capabilities?.creatable, key).toBe(false)
      expect(VENDOR_BILL_FIELDS[key]?.capabilities?.updatable, key).toBe(false)
    }
  })

  // §7.3 / P2, on the bill line too: the ledger's own key is the account CODE.
  // A provider's id belongs on an app-owned identity field, never in a value.
  it('the bill line codes its GL account as text, not a provider id', () => {
    expect(VENDOR_BILL_LINE_FIELDS.glAccount?.fieldType).toBe(FieldType.TEXT)
    expect(VENDOR_BILL_LINE_FIELDS.glAccount?.systemAttribute).toBe('vendor_bill_line_gl_account')
  })

  // §5.1: a bill with no PO is legal - a freight invoice, a one-off. Making
  // this required would make the commonest exception unrecordable.
  it('purchaseOrder is nullable on the bill and on the line', () => {
    expect(VENDOR_BILL_FIELDS.purchaseOrder?.nullable).toBe(true)
    expect(VENDOR_BILL_LINE_FIELDS.purchaseOrderLine?.nullable).toBe(true)
    expect(VENDOR_BILL_FIELDS.vendor?.nullable).toBe(false)
    expect(VENDOR_BILL_LINE_FIELDS.vendorBill?.nullable).toBe(false)
  })

  it('the payment header carries the bank-reconciliation columns the flat model lacked', () => {
    for (const key of ['bankTransactionId', 'clearedAt', 'reconciledAt', 'unallocated'] as const) {
      expect(VENDOR_PAYMENT_FIELDS[key], `vendor_payment is missing ${key}`).toBeDefined()
    }
    // `unallocated` is `amount - Σ allocations`; a non-zero value is a vendor
    // credit, which only means something if nobody can type over it.
    expect(VENDOR_PAYMENT_FIELDS.unallocated?.capabilities?.creatable).toBe(false)
    expect(VENDOR_PAYMENT_FIELDS.unallocated?.capabilities?.updatable).toBe(false)
    expect(VendorPaymentStatus.values.map((v) => v.value)).toEqual(['draft', 'posted', 'void'])
  })
})

describe('the chart of accounts is ours', () => {
  // P2. The provider's id for an account is an app-owned identity field hung
  // off this row - the identical pattern `gl_posting` already uses for
  // `qboJournalEntryId` - which is what makes a second accounting provider a
  // second identity field and nothing else.
  it('gl_account models a code, a name and a type, and no provider id', () => {
    expect(GL_ACCOUNT_FIELDS.code?.systemAttribute).toBe('gl_account_code')
    expect(GL_ACCOUNT_FIELDS.code?.fieldType).toBe(FieldType.TEXT)
    expect(GL_ACCOUNT_FIELDS.name?.systemAttribute).toBe('gl_account_name')
    expect(GL_ACCOUNT_FIELDS.accountType?.systemAttribute).toBe('gl_account_type')
    const attrs = Object.values(GL_ACCOUNT_FIELDS).map((f) => f.systemAttribute)
    expect(attrs.some((a) => a?.includes('qbo') || a?.includes('quickbooks'))).toBe(false)
  })

  it('accountType is the five statement classifications, wired to the enum list', () => {
    expect(GlAccountType.values.map((v) => v.value)).toEqual([
      'asset',
      'liability',
      'equity',
      'revenue',
      'expense',
    ])
    expect(GL_ACCOUNT_FIELDS.accountType?.options).toEqual({ options: GlAccountType.values })
  })

  // `isIdentifier`, NOT `naturalKeyPosition: 1`. A natural key is a COMPOSITE -
  // `vendor_part` is keyed on (part, supplier), `subpart` on (parentPart,
  // childPart). A lone position-1 leg is the single-field case wearing the
  // composite's clothes, and `identifier-fields.test.ts` rejects it by name.
  it('the code is the row identity, unique per org and never null', () => {
    expect(GL_ACCOUNT_FIELDS.code?.nullable).toBe(false)
    expect(GL_ACCOUNT_FIELDS.code?.isIdentifier).toBe(true)
    expect(GL_ACCOUNT_FIELDS.code?.naturalKeyPosition).toBeUndefined()
    expect(GL_ACCOUNT_FIELDS.code?.capabilities?.unique).toBe(true)
  })
})

describe('gl_posting_line', () => {
  // §7.3. `amount` is always POSITIVE and `direction` carries the sign. Storing
  // a signed amount AND a direction lets the two disagree, and a ledger that
  // can contradict itself is not a ledger.
  it('direction carries the sign, so amount stays positive', () => {
    expect(GlPostingLineDirection.values.map((v) => v.value)).toEqual(['debit', 'credit'])
    expect(GL_POSTING_LINE_FIELDS.direction?.options).toEqual({
      options: GlPostingLineDirection.values,
    })
    expect(GL_POSTING_LINE_FIELDS.amount?.fieldType).toBe(FieldType.CURRENCY)
  })

  // P2, again and where it matters most: a line keyed on a provider's account
  // id makes the whole subledger only as portable as that provider.
  it('codes its account as text, never as a provider id or a relation', () => {
    expect(GL_POSTING_LINE_FIELDS.accountCode?.systemAttribute).toBe('gl_posting_line_account_code')
    expect(GL_POSTING_LINE_FIELDS.accountCode?.fieldType).toBe(FieldType.TEXT)
    const attrs = Object.values(GL_POSTING_LINE_FIELDS).map((f) => f.systemAttribute)
    expect(attrs.some((a) => a?.includes('qbo') || a?.includes('quickbooks'))).toBe(false)
  })

  // sourceType + sourceId is what makes a posting explainable three years later
  // without joining through a provider's API.
  it('carries the audit trail back to the row that produced it', () => {
    expect(GL_POSTING_LINE_FIELDS.sourceType?.systemAttribute).toBe('gl_posting_line_source_type')
    expect(GL_POSTING_LINE_FIELDS.sourceId?.systemAttribute).toBe('gl_posting_line_source_id')
  })

  // §7.3, and it is a real trap: an earlier draft put `naturalKeyPosition: 1`
  // on this field, which declares that an entry has at most ONE line. A natural
  // key here needs a second leg (sortOrder, or accountCode + direction) or none
  // at all - and none is right.
  it('glPosting carries NO naturalKeyPosition — an entry has many lines', () => {
    expect(GL_POSTING_LINE_FIELDS.glPosting?.naturalKeyPosition).toBeUndefined()
    expect(GL_POSTING_LINE_FIELDS.glPosting?.nullable).toBe(false)
  })

  // The chart itself is NOT seeded by this migration: which codes exist is a
  // phase-0 question against the live books, and seeding a guessed chart into
  // every org is worse than an empty one.
  it('does not relate a posting line to an account row — the code is the join', () => {
    expect(GL_POSTING_LINE_FIELDS.accountCode?.fieldType).not.toBe(FieldType.RELATIONSHIP)
    for (const [key, field] of Object.entries(GL_ACCOUNT_FIELDS)) {
      expect(field.relationship, `gl_account.${key} should not be a relationship`).toBeUndefined()
    }
  })
})

// ─── Relationship pairs ──────────────────────────────────────────────────────

describe('relationship pairs', () => {
  // `linkNewRelationships` looks the inverse up by this exact string in the
  // merged field map - a mismatch on either side is a silent no-link.
  const pairs = [
    {
      name: 'stock_movement.vendorPart ↔ vendor_part.stockMovements',
      owning: STOCK_MOVEMENT_FIELDS.vendorPart,
      owningRef: 'vendor_part:stockMovements',
      inverse: VENDOR_PART_FIELDS.stockMovements,
      inverseRef: 'stock_movement:vendorPart',
    },
    {
      name: 'stock_movement.purchaseOrderLine ↔ purchase_order_line.stockMovements',
      owning: STOCK_MOVEMENT_FIELDS.purchaseOrderLine,
      owningRef: 'purchase_order_line:stockMovements',
      inverse: PURCHASE_ORDER_LINE_FIELDS.stockMovements,
      inverseRef: 'stock_movement:purchaseOrderLine',
    },
    {
      name: 'purchase_order.vendor ↔ company.purchaseOrders',
      owning: PURCHASE_ORDER_FIELDS.vendor,
      owningRef: 'company:purchaseOrders',
      inverse: COMPANY_FIELDS.purchaseOrders,
      inverseRef: 'purchase_order:vendor',
    },
    {
      // The ADDRESSEE pair. Without it a PO has no email recipient at all:
      // `vendor` targets a `company`, and a company carries no email of its own.
      name: 'purchase_order.contact ↔ contact.purchaseOrders',
      owning: PURCHASE_ORDER_FIELDS.contact,
      owningRef: 'contact:purchaseOrders',
      inverse: CONTACT_FIELDS.purchaseOrders,
      inverseRef: 'purchase_order:contact',
    },
    {
      name: 'purchase_order_line.purchaseOrder ↔ purchase_order.lines',
      owning: PURCHASE_ORDER_LINE_FIELDS.purchaseOrder,
      owningRef: 'purchase_order:lines',
      inverse: PURCHASE_ORDER_FIELDS.lines,
      inverseRef: 'purchase_order_line:purchaseOrder',
    },
    {
      name: 'purchase_order_line.part ↔ part.purchaseOrderLines',
      owning: PURCHASE_ORDER_LINE_FIELDS.part,
      owningRef: 'part:purchaseOrderLines',
      inverse: PART_FIELDS.purchaseOrderLines,
      inverseRef: 'purchase_order_line:part',
    },
    {
      name: 'purchase_order_line.vendorPart ↔ vendor_part.purchaseOrderLines',
      owning: PURCHASE_ORDER_LINE_FIELDS.vendorPart,
      owningRef: 'vendor_part:purchaseOrderLines',
      inverse: VENDOR_PART_FIELDS.purchaseOrderLines,
      inverseRef: 'purchase_order_line:vendorPart',
    },
    {
      name: 'vendor_bill.vendor ↔ company.vendorBills',
      owning: VENDOR_BILL_FIELDS.vendor,
      owningRef: 'company:vendorBills',
      inverse: COMPANY_FIELDS.vendorBills,
      inverseRef: 'vendor_bill:vendor',
    },
    {
      name: 'vendor_bill.purchaseOrder ↔ purchase_order.bills',
      owning: VENDOR_BILL_FIELDS.purchaseOrder,
      owningRef: 'purchase_order:bills',
      inverse: PURCHASE_ORDER_FIELDS.bills,
      inverseRef: 'vendor_bill:purchaseOrder',
    },
    {
      name: 'vendor_bill_line.vendorBill ↔ vendor_bill.lines',
      owning: VENDOR_BILL_LINE_FIELDS.vendorBill,
      owningRef: 'vendor_bill:lines',
      inverse: VENDOR_BILL_FIELDS.lines,
      inverseRef: 'vendor_bill_line:vendorBill',
    },
    {
      name: 'vendor_bill_line.purchaseOrderLine ↔ purchase_order_line.vendorBillLines',
      owning: VENDOR_BILL_LINE_FIELDS.purchaseOrderLine,
      owningRef: 'purchase_order_line:vendorBillLines',
      inverse: PURCHASE_ORDER_LINE_FIELDS.vendorBillLines,
      inverseRef: 'vendor_bill_line:purchaseOrderLine',
    },
    {
      // The part is STAMPED onto the line from the PO line, never hand-set -
      // provenance and spend-by-part grouping only, never a matching input.
      name: 'vendor_bill_line.part ↔ part.vendorBillLines',
      owning: VENDOR_BILL_LINE_FIELDS.part,
      owningRef: 'part:vendorBillLines',
      inverse: PART_FIELDS.vendorBillLines,
      inverseRef: 'vendor_bill_line:part',
    },
    {
      name: 'vendor_payment.vendor ↔ company.vendorPayments',
      owning: VENDOR_PAYMENT_FIELDS.vendor,
      owningRef: 'company:vendorPayments',
      inverse: COMPANY_FIELDS.vendorPayments,
      inverseRef: 'vendor_payment:vendor',
    },
    {
      name: 'vendor_payment_allocation.payment ↔ vendor_payment.allocations',
      owning: VENDOR_PAYMENT_ALLOCATION_FIELDS.payment,
      owningRef: 'vendor_payment:allocations',
      inverse: VENDOR_PAYMENT_FIELDS.allocations,
      inverseRef: 'vendor_payment_allocation:payment',
    },
    {
      name: 'vendor_payment_allocation.vendorBill ↔ vendor_bill.paymentAllocations',
      owning: VENDOR_PAYMENT_ALLOCATION_FIELDS.vendorBill,
      owningRef: 'vendor_bill:paymentAllocations',
      inverse: VENDOR_BILL_FIELDS.paymentAllocations,
      inverseRef: 'vendor_payment_allocation:vendorBill',
    },
    {
      name: 'gl_posting_line.glPosting ↔ gl_posting.lines',
      owning: GL_POSTING_LINE_FIELDS.glPosting,
      owningRef: 'gl_posting:lines',
      inverse: GL_POSTING_FIELDS.lines,
      inverseRef: 'gl_posting_line:glPosting',
    },
  ] as const

  for (const pair of pairs) {
    it(`${pair.name} point at each other`, () => {
      expect(pair.owning?.fieldType).toBe(FieldType.RELATIONSHIP)
      expect(pair.owning?.relationship).toMatchObject({
        inverseResourceFieldId: pair.owningRef,
        relationshipType: 'belongs_to',
        isInverse: false,
      })
      expect(pair.inverse?.relationship).toMatchObject({
        inverseResourceFieldId: pair.inverseRef,
        relationshipType: 'has_many',
        isInverse: true,
      })
    })
  }

  it('stock_movement.vendorPart and part.vendorBillLines agree on their inverse attributes', () => {
    expect(STOCK_MOVEMENT_FIELDS.vendorPart?.relationshipConfig?.inverseSystemAttribute).toBe(
      VENDOR_PART_FIELDS.stockMovements?.systemAttribute
    )
    expect(PART_FIELDS.vendorBillLines?.systemAttribute).toBe('part_vendor_bill_lines')
    expect(isSystemAttribute('part_vendor_bill_lines')).toBe(true)
  })

  // `relationshipConfig` is the seeder's own path to an inverse (it is how the
  // `stock_movement` self-relations get linked at all, since they carry no
  // `relationship.inverseResourceFieldId`). Where an owning half declares one it
  // must agree with the field it points at — a disagreement gives the two link
  // paths different answers for the same pair.
  //
  // `vendor_bill_line.part` is the ONE owning half here that declares none, and
  // it is pinned by name so the `continue` below cannot quietly widen into a
  // vacuous loop.
  it('the owning halves agree with their inverse on systemAttribute', () => {
    const withoutConfig: string[] = []
    let checked = 0
    for (const pair of pairs) {
      if (!pair.owning?.relationshipConfig?.inverseSystemAttribute) {
        withoutConfig.push(pair.name)
        continue
      }
      checked++
      expect(pair.owning.relationshipConfig.inverseSystemAttribute, pair.name).toBe(
        pair.inverse?.systemAttribute
      )
    }
    expect(withoutConfig).toEqual(['vendor_bill_line.part ↔ part.vendorBillLines'])
    expect(checked).toBe(pairs.length - 1)
  })

  it('the required legs are required, and the optional ones stay optional', () => {
    expect(PURCHASE_ORDER_FIELDS.vendor?.nullable).toBe(false)
    // Unlike `quote_contact`, which is required: a PO is drafted against a
    // supplier first, and who to send it to is settled later. Requiring it here
    // would block the create dialog on a person nobody has picked yet.
    expect(PURCHASE_ORDER_FIELDS.contact?.nullable).toBe(true)
    expect(PURCHASE_ORDER_FIELDS.contact?.required).toBeUndefined()
    expect(PURCHASE_ORDER_LINE_FIELDS.purchaseOrder?.nullable).toBe(false)
    expect(PURCHASE_ORDER_LINE_FIELDS.part?.nullable).toBe(false)
    expect(PURCHASE_ORDER_LINE_FIELDS.vendorPart?.nullable).toBe(true)
    expect(STOCK_MOVEMENT_FIELDS.vendorPart?.nullable).toBe(true)
    expect(STOCK_MOVEMENT_FIELDS.purchaseOrderLine?.nullable).toBe(true)
  })

  // `linkNewRelationships` splits the reference on ':' and looks the prefix up
  // in the entityDefIds map, so the prefix must be an entityType, not an
  // apiSlug, and the suffix must be the counterpart's registry KEY.
  it('names counterparts by entityType and registry key, not apiSlug', () => {
    const refs = [
      STOCK_MOVEMENT_FIELDS.vendorPart!.relationship!.inverseResourceFieldId,
      STOCK_MOVEMENT_FIELDS.purchaseOrderLine!.relationship!.inverseResourceFieldId,
      VENDOR_PART_FIELDS.stockMovements!.relationship!.inverseResourceFieldId,
      PURCHASE_ORDER_LINE_FIELDS.stockMovements!.relationship!.inverseResourceFieldId,
    ] as string[]
    expect(refs.map((r) => r.split(':')[0])).toEqual([
      'vendor_part',
      'purchase_order_line',
      'stock_movement',
      'stock_movement',
    ])
  })

  // `linkNewRelationships` looks the inverse up by an exact string in the merged
  // field map, so a reference whose target KEY does not exist on the target
  // registry can never link. It is not an error either - the linker logs a debug
  // line and moves on - which is precisely why it needs a test rather than a
  // reviewer. Every half these registries declare must resolve; there is no
  // tolerated exception, and adding one would need a deliberate edit here.
  it('every relationship half names an inverse that exists on the target registry', () => {
    const registries = RESOURCE_FIELD_REGISTRY as unknown as Record<
      string,
      Record<string, ResourceField>
    >
    const unlinkable: string[] = []
    for (const [entityType, fields] of Object.entries(NEW_REGISTRIES)) {
      for (const [key, field] of Object.entries(fields)) {
        const ref = field.relationship?.inverseResourceFieldId as string | undefined
        if (!ref) continue
        const [targetType, targetKey] = ref.split(':')
        expect(
          registries[targetType!],
          `${entityType}.${key} targets unknown entityType '${targetType}'`
        ).toBeDefined()
        if (!registries[targetType!]?.[targetKey!])
          unlinkable.push(`${entityType}.${key} -> ${ref}`)
      }
    }
    expect(unlinkable).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// One-pass linking — the property the merge exists to buy.
//
// The old 108 -> 109 -> 110 sequence declared edges whose target def did not
// exist yet, so `linkNewRelationships` skipped them with a debug line and a
// LATER migration had to re-read the already-materialised row out of the
// database and re-insert it into its own field map purely so the linker could
// see it. Three such blocks, each silent if dropped.
//
// Creating all eight defs in one pass removes the whole mechanism: every edge's
// counterpart is in the SAME map, so one call resolves all of them. That is not
// a claim to take on trust, so it is asserted twice - statically, against the
// exact key set `up()` builds, and dynamically, by counting what the linker
// actually writes.
// ─────────────────────────────────────────────────────────────────────────────

describe('every relationship half resolves in the single linking pass', () => {
  it('leaves no relationship field on any affected def unlinked', () => {
    const materialised = materialisedFields()
    const dangling: string[] = []
    for (const [key, field] of materialised) {
      const ref = field.relationship?.inverseResourceFieldId as string | undefined
      if (!ref) continue
      const [inverseEntityType] = ref.split(':')
      // The linker skips `user` targets by design; nothing here has one.
      if (inverseEntityType === 'user') continue
      if (!materialised.has(ref)) dangling.push(`${key} -> ${ref}`)
    }
    expect(dangling).toEqual([])
  })

  it('links exactly as many edges as it declares, in one run', async () => {
    const writes: string[] = []
    // Every def and field exists but NOTHING is linked yet, so the linker has
    // real work to do and `relationshipsLinked` is a true count.
    const db = migratedOrgDb(writes, { linked: false })

    const result = await migration108Purchasing.up(db, 'org-1')

    const expected = [...materialisedFields().values()].filter(
      (f) => f.relationship?.inverseResourceFieldId
    ).length

    expect(expected).toBeGreaterThan(0)
    expect(result.relationshipsLinked).toBe(expected)
    expect(result.entityDefsCreated).toBe(0)
    expect(result.fieldsCreated).toBe(0)
    expect(result.alreadyUpToDate).toBe(false)
    expect(writes.filter((w) => w.startsWith('insert'))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// P13 — `vendor_payment` and `vendor_payment_allocation` ship INERT.
//
// The condition attached to the decision is not "we intend not to write them",
// it is "both tables stay EMPTY": a def with zero rows can be reshaped for free
// and the first row ends that, permanently. There is also a known transition
// waiting at switch-on — `vendor_bill.amountPaid` is written DIRECTLY today and
// becomes DERIVED from the sum of allocations later, and those cannot both be
// true — so a stray writer now is not a harmless head start, it is data that
// has to be reconciled by hand.
//
// A comment claiming this decays the moment someone adds a seeder "just for the
// demo org". So it is asserted against the source tree instead. The check is
// deliberately stronger than "nothing writes": nothing outside the declaration
// files may so much as NAME these entity types, because a reference is the
// first step of a writer and an allowlist entry is a reviewable edit.
// ─────────────────────────────────────────────────────────────────────────────

/** Files that legitimately name the inert entities: declarations and this migration. */
const INERT_DECLARATION_FILES = [
  'resources/registry/field-registry.ts',
  'resources/registry/resources/company-fields.ts',
  'resources/registry/resources/vendor-bill-fields.ts',
  'resources/registry/resources/vendor-payment-allocation-fields.ts',
  'resources/registry/resources/vendor-payment-fields.ts',
  'seed/entity-migrations/migrations/108-purchasing.ts',
  'seed/entity-migrations/migrations/108-purchasing.test.ts',
  'seed/entity-seeder/constants.ts',
  'seed/entity-seeder/create-fields.ts',
]

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkTsFiles(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('the inert payment entities stay inert (P13)', () => {
  it('nothing in packages/lib/src names them outside the declaration files', () => {
    const libSrc = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
    const allowed = new Set(INERT_DECLARATION_FILES)
    const offenders: string[] = []

    for (const file of walkTsFiles(libSrc)) {
      const rel = relative(libSrc, file).split(sep).join('/')
      if (allowed.has(rel)) continue
      const source = readFileSync(file, 'utf8')
      if (source.includes('vendor_payment') || source.includes('VENDOR_PAYMENT')) {
        offenders.push(rel)
      }
    }

    expect(offenders).toEqual([])
  })

  it('has no write path of its own — no router, no hook, no seeder', () => {
    // The registry entries exist so the defs can be materialised; nothing more.
    expect(RESOURCE_FIELD_REGISTRY.vendor_payment).toBe(VENDOR_PAYMENT_FIELDS)
    expect(RESOURCE_FIELD_REGISTRY.vendor_payment_allocation).toBe(VENDOR_PAYMENT_ALLOCATION_FIELDS)
    // No saved list view: a hidden entity with no rows has nothing to list, and
    // a seeded view is the kind of thing that grows a "create" button.
    expect(DEFAULT_VIEW_CONFIGS).not.toHaveProperty('vendor_payment')
    expect(DEFAULT_VIEW_CONFIGS).not.toHaveProperty('vendor_payment_allocation')
  })
})

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('migration 108 idempotency', () => {
  it('creates nothing and reports alreadyUpToDate on a second run', async () => {
    const writes: string[] = []
    const db = migratedOrgDb(writes)

    const result = await migration108Purchasing.up(db, 'org-1')

    expect(result).toEqual({
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    })
    // No inserts at all. The only writes allowed are `linkDisplayFields`'
    // unconditional re-stamp of the display-field ids on the new defs - it
    // re-writes the values it just read, so it is a no-op in content even
    // though it is a statement.
    expect(writes.filter((w) => w.startsWith('insert'))).toEqual([])
    expect(new Set(writes)).toEqual(new Set(['update EntityDefinition']))
  })

  // The 003 bail-out: `stock_movement` is seeded by migration 002, and an org
  // that has not reached it must be skipped rather than fail the whole run -
  // 002 seeds the full registry, so it picks these fields up itself.
  it('skips an org with no stock_movement def, without touching anything', async () => {
    const writes: string[] = []
    const db = stubDb(new Map<unknown, unknown[]>(), writes)

    const result = await migration108Purchasing.up(db, 'org-2')

    expect(writes).toEqual([])
    expect(result).toEqual({
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    })
  })

  // 103 seeds `gl_posting`. An org that has not reached it yet must still get
  // its eight new defs - the linker simply skips the half it cannot resolve,
  // and a later run closes it.
  it('tolerates a missing gl_posting def', async () => {
    const writes: string[] = []
    const db = migratedOrgDb(writes, { omit: ['gl_posting'] })

    const result = await migration108Purchasing.up(db, 'org-3')

    expect(result.alreadyUpToDate).toBe(true)
    expect(writes.filter((w) => w.startsWith('insert'))).toEqual([])
  })

  // 🛑 The half of the option-refresh that actually matters. The first test
  // proves it stays QUIET when the stored options already match; these prove it
  // FIRES when they do not. Without them, changing an enum in `enum-values.ts`
  // would reach a fresh org and silently skip every org that already ran 108 —
  // `ensureCustomFields` returns an incumbent field untouched — leaving the code
  // and the database disagreeing about what values exist.
  //
  // Both directions are covered: `vendor_bill_status` GAINED `partially_paid`,
  // `purchase_order_status` LOST `partially_received` / `received` to the two
  // derived fields (07 §3.3). Narrowing is the one that matters more — a stored
  // option nobody removed keeps rendering a value the type union no longer has.
  it.each([
    'vendor_bill_status',
    'purchase_order_status',
  ] as const)('rewrites a stale %s option list, and says it did', async (systemAttribute) => {
    const writes: string[] = []
    const db = migratedOrgDb(writes, { staleStatus: systemAttribute })

    const result = await migration108Purchasing.up(db, `org-${systemAttribute}`)

    expect(writes).toContain('update CustomField')
    // Not `alreadyUpToDate`: a run that only rewrote options must still report
    // work, or it skips the org-cache flush that makes the change visible to
    // every read path.
    expect(result.alreadyUpToDate).toBe(false)
  })
})
