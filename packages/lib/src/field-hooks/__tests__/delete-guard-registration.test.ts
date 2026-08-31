// packages/lib/src/field-hooks/__tests__/delete-guard-registration.test.ts
//
// Which entities have a pre-delete hook, pinned as a set.
//
// 🛑 **This file exists because the same defect has now been fixed four times
// by naming one entity.** `registerEntityPreDeleteHooks` was added for `tags`
// alone, which left every other type leaking; plan
// `plans/dispatch/money/12-delete-safety.md` extended it to the dispatch money
// documents; `orders` was added a month later when its lines were found
// orphaned; `parts` was found unguarded a further six weeks after that, having
// shipped `isVisible: true` with an ordinary delete button the whole time
// (plans/money/tasks/20-part-delete-safety.md §1); and `builds`,
// `purchase-orders` and `vendor-bills` were still unguarded when task 20
// shipped, which is what task 21 closed.
//
// `sweep-entity-references.ts` states the rule the guards kept failing: a fix
// has to be "keyed off the mechanism (a record is going away), not off a
// registration list, or it drifts the same way again". A pre-delete hook IS a
// registration list and cannot be keyed off the mechanism — so the next best
// thing is to derive the list that SHOULD exist from the seeded entity
// definitions, and assert the registry covers it.
//
// Registered under the **apiSlug**, never the entityType: `deleteEntity` reads
// `getEntityPreDeleteHooks(entityDef.apiSlug)`, so `part` would be a silent
// no-op where `parts` is the hook.

import { describe, expect, it } from 'vitest'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import { guardBuildDelete } from '../pre/build-delete-guard'
import { guardInvoiceDelete } from '../pre/invoice-delete-guard'
import { cascadeOrderLinesOnDelete } from '../pre/order-delete-guard'
import { guardPartDelete } from '../pre/part-delete-guard'
import { guardPurchaseOrderDelete } from '../pre/purchase-order-delete-guard'
import { guardVendorBillDelete } from '../pre/vendor-bill-delete-guard'
import { getEntityPreDeleteHooks } from '../registry'

/** Every slug that must carry a pre-delete hook, and the handler it must carry. */
const GUARDED = [
  { slug: 'invoices', handler: guardInvoiceDelete },
  { slug: 'orders', handler: cascadeOrderLinesOnDelete },
  { slug: 'parts', handler: guardPartDelete },
  { slug: 'builds', handler: guardBuildDelete },
  { slug: 'purchase-orders', handler: guardPurchaseOrderDelete },
  { slug: 'vendor-bills', handler: guardVendorBillDelete },
] as const

/**
 * The inventory/purchasing subsystem's entity types, from
 * `docs/inventory-costing-architecture-guide.md` §3 — the table that calls them
 * "thirteen entities, zero new tables", minus `gl_posting` and
 * `gl_posting_line`, which entity migration 114 deleted because they are Drizzle
 * tables and never were entities.
 *
 * This list is what makes the assertion below meaningful rather than circular:
 * it is a claim about the SUBSYSTEM, checked against the seeded definitions, not
 * a restatement of what happens to be registered.
 */
const MONEY_ENTITY_TYPES = [
  'purchase_order',
  'purchase_order_line',
  'vendor_bill',
  'vendor_bill_line',
  'stock_movement',
  'build',
  'part',
  'vendor_part',
  'subpart',
  'gl_account',
  'vendor_payment',
  'vendor_payment_allocation',
] as const

/**
 * A money entity is a "parent" for delete purposes when it is `isVisible` — that
 * is what gives it an ordinary records table with an ordinary row delete and
 * bulk delete that no money code has ever seen. `isVisible` is optional in
 * `SystemEntityConfig` and **defaults to true**, which is precisely how `parts`
 * shipped unguarded: nobody wrote `isVisible: true`, it simply was.
 */
function visibleMoneyParents(): string[] {
  return SYSTEM_ENTITIES.filter(
    (entity) =>
      (MONEY_ENTITY_TYPES as readonly string[]).includes(entity.entityType) &&
      entity.isVisible !== false
  )
    .map((entity) => entity.apiSlug)
    .sort()
}

describe('pre-delete hook registration', () => {
  for (const { slug, handler } of GUARDED) {
    it(`registers a pre-delete hook for ${slug}`, () => {
      expect(getEntityPreDeleteHooks(slug)).toContain(handler)
    })
  }

  it('registers parts under the apiSlug, not the entityType', () => {
    expect(getEntityPreDeleteHooks('part')).toHaveLength(0)
  })

  it('names only entity types that are actually seeded', () => {
    const seeded = new Set(SYSTEM_ENTITIES.map((entity) => entity.entityType))
    const missing = MONEY_ENTITY_TYPES.filter((type) => !seeded.has(type))
    // A rename in `constants.ts` must not quietly shrink the set below.
    expect(missing).toEqual([])
  })

  it('guards EVERY visible money parent (task 21 §6)', () => {
    // The positive form, deliberately. The old assertion listed the entities
    // that were still unguarded and asserted they still were — which went
    // vacuously true the moment the list emptied, and would have protected
    // nothing from then on.
    const unguarded = visibleMoneyParents().filter(
      (slug) => getEntityPreDeleteHooks(slug).length === 0
    )
    expect(unguarded).toEqual([])
  })

  it('holds the four visible money parents the costing guide §3 names', () => {
    // Pins the derivation itself: if a money entity flips to visible, or a new
    // one ships visible, this fails and the guard question gets asked BEFORE the
    // delete button is live — which is the whole point of the file.
    expect(visibleMoneyParents()).toEqual(['builds', 'parts', 'purchase-orders', 'vendor-bills'])
  })
})
