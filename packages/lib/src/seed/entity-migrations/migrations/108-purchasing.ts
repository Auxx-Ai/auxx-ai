// packages/lib/src/seed/entity-migrations/migrations/108-purchasing.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { GL_ACCOUNT_FIELDS } from '../../../resources/registry/resources/gl-account-fields'
import { GL_POSTING_FIELDS } from '../../../resources/registry/resources/gl-posting-fields'
import { GL_POSTING_LINE_FIELDS } from '../../../resources/registry/resources/gl-posting-line-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { PURCHASE_ORDER_FIELDS } from '../../../resources/registry/resources/purchase-order-fields'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../../resources/registry/resources/purchase-order-line-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../../resources/registry/resources/stock-movement-fields'
import { VENDOR_BILL_FIELDS } from '../../../resources/registry/resources/vendor-bill-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../../resources/registry/resources/vendor-bill-line-fields'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { VENDOR_PAYMENT_ALLOCATION_FIELDS } from '../../../resources/registry/resources/vendor-payment-allocation-fields'
import { VENDOR_PAYMENT_FIELDS } from '../../../resources/registry/resources/vendor-payment-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { DEFAULT_VIEW_CONFIGS } from '../../default-view-configs'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureDefaultTableViews,
  ensureEntityDefinitions,
  ensureFieldViews,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:108')

/**
 * The eight defs this migration creates, in dependency order (which is also
 * `SYSTEM_ENTITIES` order, so the filter below preserves it).
 */
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

/** Registry per new def — the full field set of each is materialised. */
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

/**
 * Pre-existing defs that receive fields here. `stock_movement` is the hard
 * dependency (checked separately); the rest are tolerated as absent, since an
 * org that has not reached the migration that seeds them has nothing to hang
 * an inverse off yet and a later run closes it.
 */
const EXISTING_TYPES = [
  'stock_movement',
  'company',
  'contact',
  'part',
  'vendor_part',
  'gl_posting',
] as const

/**
 * The ten receiving fields added to `stock_movement`
 * (plans/purchasing/01-build-plan.md §2.1). Listed by registry key rather than
 * taken as "everything new in `STOCK_MOVEMENT_FIELDS`", so a later unrelated
 * field on that registry does not silently join this migration's payload.
 */
const RECEIVING_FIELD_KEYS = [
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
 * Fields this migration adds to defs it does not create.
 *
 * Almost all are the inverse halves of edges owned by the eight new defs — a
 * `has_many` on an incumbent whose owning `belongs_to` lives on a new one.
 * `part.unit` is the exception: a plain SINGLE_SELECT, added here because the
 * purchasing lines are the first surface that needs to render a unit and the
 * part is where the stock UOM belongs (see its registry comment).
 */
const INCUMBENT_FIELDS: Record<string, Record<string, ResourceField | undefined>> = {
  company: {
    purchaseOrders: COMPANY_FIELDS.purchaseOrders,
    vendorBills: COMPANY_FIELDS.vendorBills,
    vendorPayments: COMPANY_FIELDS.vendorPayments,
  },
  contact: {
    // Inverse of `purchase_order.contact`, the order's ADDRESSEE. The buy-side
    // twin of `contact.orders`.
    purchaseOrders: CONTACT_FIELDS.purchaseOrders,
  },
  part: {
    purchaseOrderLines: PART_FIELDS.purchaseOrderLines,
    vendorBillLines: PART_FIELDS.vendorBillLines,
    // Not an inverse — the stock unit of measure every part quantity is in.
    unit: PART_FIELDS.unit,
  },
  vendor_part: {
    stockMovements: VENDOR_PART_FIELDS.stockMovements,
    purchaseOrderLines: VENDOR_PART_FIELDS.purchaseOrderLines,
  },
  gl_posting: {
    lines: GL_POSTING_FIELDS.lines,
  },
}

/**
 * Migration 108: purchase-to-pay in one pass — receiving cost on
 * `stock_movement`, `purchase_order` + `purchase_order_line`, `vendor_bill` +
 * `vendor_bill_line`, the inert `vendor_payment` + `vendor_payment_allocation`
 * pair, and the `gl_account` + `gl_posting_line` posting seam
 * (plans/purchasing/01-build-plan.md §2.4, §4.5, §5.2, §7.3).
 *
 * ## Why this is ONE migration and not four
 *
 * `linkNewRelationships` links what is in the FIELD MAP it is handed, not what
 * is in the database. Split across a 108 -> 109 -> 110 sequence, that forces a
 * rehydration dance: 108 would create `stock_movement.purchaseOrderLine` while
 * `purchase_order_line` did not exist yet, so the linker would skip it with a
 * debug line and leave the edge dangling; 109 would then have to re-read that
 * already-materialised row out of `ExistingState` and re-insert it into its own
 * map purely so the linker could see it — and 109 would in turn leave
 * `purchase_order.bills` and `purchase_order_line.vendorBillLines` dangling for
 * 110 to close the same way. Three separate "close the previous migration's
 * hole" blocks, each of them silent if it were ever dropped.
 *
 * With every def created in one pass, none of that exists. Every edge's
 * counterpart is materialised into the SAME map before the single
 * `linkNewRelationships` call, so all of them resolve there. Do not reintroduce
 * a rehydration block: if one is ever needed again, that means a def moved out
 * of this migration, and the fix is to move it back.
 *
 * ## What it adds
 *
 * On the incumbent `stock_movement` (§2):
 *
 *   stock_movement.unitCost             CURRENCY   frozen landed cost per unit
 *   stock_movement.extendedCost         CURRENCY   signed like `quantity`
 *   stock_movement.costBasis            SELECT     `standard | actual`
 *   stock_movement.glAccount            TEXT       the account CODE, never a provider id
 *   stock_movement.occurredAt           DATETIME   the accounting date
 *   stock_movement.vendorPart           belongs_to -> vendor_part
 *   stock_movement.vendorUnitPrice      CURRENCY   raw supplier price, pre-landing
 *   stock_movement.purchaseOrderLine    belongs_to -> purchase_order_line
 *   stock_movement.reversesMovement     belongs_to -> stock_movement  (self)
 *   stock_movement.reversedByMovements  has_many   -> stock_movement  (the inverse)
 *
 * The two self-relations carry `relationshipConfig` but no
 * `relationship.inverseResourceFieldId`, exactly like the existing
 * `parentMovement` / `childMovements` pair, so the linker skips them by design;
 * the seeder materialises them from `relationshipConfig`.
 *
 * The eight new defs, with their full registries, plus the inverse halves on
 * `company` (purchaseOrders / vendorBills / vendorPayments), `contact`
 * (purchaseOrders), `part` (purchaseOrderLines / vendorBillLines),
 * `vendor_part` (stockMovements / purchaseOrderLines) and `gl_posting` (lines).
 *
 * `purchase_order.contact` / `contact.purchaseOrders` is the ADDRESSEE pair, and
 * it is what makes the order sendable at all: `purchase_order.vendor` targets a
 * `company`, and a company carries no email of its own — only
 * `company_primary_contact` — so there would be nobody to address the mail to.
 * Shaped after `quote_contact` / `invoice_contact` so the send path's contact
 * lookup extends by a map entry rather than a branch, but NULLABLE where the
 * quote's is required: a PO is drafted against a supplier first and the person
 * is settled later.
 *
 * `purchase_order.pdfAsset` (`purchase_order_pdf_asset`) is the third field the
 * send flow needs and the second one it fails SILENTLY without: `ensure-pdf.ts`
 * reads `cf[pointerAttr]` to decide whether to reuse the last render, so a
 * missing pointer makes `existingAssetId` permanently `undefined` and every
 * send re-renders AND mints a fresh `MediaAsset`. Nothing throws, the PDF is
 * correct, and the only symptom is unbounded storage growth. Copied verbatim
 * from `quote_pdf_asset` / `invoice_pdf_asset`, because all three are read
 * through the same code path and only `ensureDocumentPdf` writes them.
 *
 * ⚠️ All three were a bare MediaAsset id in TEXT when this migration was
 * written. `112-record-documents` made them single `FILE` fields, read-only via
 * `isUpdatable: false`. This migration reads the registry, so a FRESH org gets
 * the new shape here and 112 is a no-op for it; 112 exists for the orgs that
 * ran 108 while the registry still said TEXT, because `ensureCustomFields` is
 * INSERT-only and can never reshape a row it already created.
 *
 * Plus one field that is not an inverse: `part.unit`, the stock unit of measure
 * (SINGLE_SELECT, nullable, no backfill). Every quantity in the inventory chain
 * — on-hand, movements, BOM, ordered/received — is already a bare number in one
 * implied unit; this names it, and purchasing rows render it read-only beside the
 * quantity. It is deliberately NOT on the line: a line ordered in `box` and
 * received in `ea` would make the received-vs-ordered roll-up compare two
 * different units, which is the number the three-way match rests on.
 *
 * ## The purchase-order status SPLIT (07 §3.3)
 *
 * `purchase_order` carries THREE status fields, not one, and this migration
 * materialises all three:
 *
 *   purchase_order_status           SELECT  draft | issued | closed | canceled
 *   purchase_order_receipt_status   SELECT  not_received | partially_received | received
 *   purchase_order_billing_status   SELECT  not_billed | partially_billed | billed
 *
 * Receiving and billing are INDEPENDENT axes. This business prepays, so *fully
 * billed, fully paid, nothing received* is a normal state lasting weeks, and one
 * enum cannot say it — whichever axis the single field picks, the other becomes
 * invisible. `vendor_bill_status` is what conflating them looks like once it has
 * shipped: `posted`/`paid` overwrite the `matched`/`exception` verdict and
 * `MATCHABLE_STATUSES` then refuses to recompute it, so a paid bill can never
 * say whether it matched. `OrderFinancialStatus` / `OrderFulfillmentStatus` are
 * the same split done right on the sell side.
 *
 * `purchase_order_status` therefore declares FOUR values here, not the six it
 * originally shipped with: `partially_received` and `received` moved to
 * `purchase_order_receipt_status`. They were the two values with no writer at
 * all, so the move costs nothing and makes `purchasing-hooks.ts`'s "a plain
 * human-set field" true rather than aspirational. Both new fields are
 * `creatable: false` / `updatable: false` / `computed: true` — the line
 * `quantityReceived` / `quantityBilled` roll-up owns them, and this migration
 * only creates the columns to write into.
 *
 * `purchase_order` is `hasDetailPage: true` and `isVisible: true` — the `quote`
 * shape, because a PO is built, issued and received against. `vendor_bill` is
 * `isVisible: true`, `hasDetailPage: false` — the `invoice` shape, drawer-only,
 * because a bill RECORDS something already settled. Every line entity is hidden
 * and managed from its header, the `subpart` / `vendor_part` precedent.
 *
 * **`vendor_payment` and `vendor_payment_allocation` ship INERT** (README P13).
 * The defs and their fields exist in every org and nothing writes them: no
 * router procedure, no UI, no hook, `isVisible: false` on both. That is not a
 * nicety — a def with zero rows can be reshaped for free and the first row ends
 * that, and switch-on carries a known reconcile (a bill's direct `amountPaid`
 * becomes derived from the sum of allocations). `108-purchasing.test.ts`
 * enforces the emptiness by scanning the source tree, because a comment cannot.
 *
 * **No backfill** (§2.5). Existing movements keep NULL cost and NULL
 * `occurredAt` and stay that way — they are not postable, and the fix for that
 * is the opening entry, not a reconstruction of what a past movement cost. The
 * chart of accounts is not seeded either: which codes exist is a phase-0
 * question against the live books (§1, 0.3), and a guessed chart in every org
 * is worse than an empty one.
 *
 * **No DDL.** `EntityDefinition.entityType` is a `text()` column, so everything
 * here is `FieldValue`-backed; a new entity type is this migration plus the
 * hand-edits to `enums.ts`, `enum-values.ts`, `field-registry.ts`,
 * `create-fields.ts`, `constants.ts`, `types/resource/utils.ts` and the
 * system-attribute union. But the registry alone is not enough: an
 * unmaterialised field means the first write hits an FK violation, which is
 * exactly what `ensureCustomFields` is for.
 *
 * Note the id space is shared across `data-migrations/migrations/` and
 * `seed/entity-migrations/migrations/` — 108 is the next free number counted
 * across BOTH (it has already collided once, at 103).
 *
 * Idempotent — every helper is insert-only or skips existing rows, and
 * `linkNewRelationships` only writes an `inverseResourceFieldId` that is null.
 */
export const migration108Purchasing: EntityMigration = {
  id: '108-purchasing',
  description:
    'Add purchase_order, purchase_order_line, vendor_bill, vendor_bill_line, the inert ' +
    'vendor_payment / vendor_payment_allocation pair, gl_account and gl_posting_line as system ' +
    'entities, plus cost, occurredAt and purchase provenance on stock_movement',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // `stock_movement` is the core dependency: it is seeded by migration 002 and
    // is what receiving actually writes. An org that has not reached 002 is
    // skipped rather than failed — 002 seeds the full registry, so it picks the
    // receiving fields up itself, and a later run of this migration adds the
    // purchasing defs.
    const smDef = existing.entityDefs.get('stock_movement')
    if (!smDef) return { ...state, alreadyUpToDate: true }

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )

    // Pull the incumbent defs into the id map so `linkNewRelationships` can
    // resolve BOTH directions of every pair in the single pass below. A def that
    // is absent (an org short of migration 103, say) simply contributes nothing.
    for (const entityType of EXISTING_TYPES) {
      const def = existing.entityDefs.get(entityType)
      if (def) entityDefIds.set(entityType, def.id)
    }

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()
    const merge = (m: typeof allFieldMaps) => {
      for (const [k, v] of m) allFieldMaps.set(k, v)
    }

    // ── The eight new defs, full registries ────────────────────────────
    for (const entityType of NEW_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          entityType,
          defId,
          NEW_REGISTRIES[entityType],
          existing,
          state
        )
      )
    }

    // ── The ten receiving fields on `stock_movement` ───────────────────
    const receivingFields: Record<string, ResourceField> = {}
    for (const key of RECEIVING_FIELD_KEYS) {
      const field = STOCK_MOVEMENT_FIELDS[key]
      if (!field) throw new Error(`STOCK_MOVEMENT_FIELDS.${key} is missing from the registry`)
      receivingFields[key] = field
    }
    merge(
      await ensureCustomFields(
        db,
        organizationId,
        'stock_movement',
        smDef.id,
        receivingFields,
        existing,
        state
      )
    )

    // ── The added fields on incumbent defs ─────────────────────────────
    for (const [entityType, fields] of Object.entries(INCUMBENT_FIELDS)) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const present: Record<string, ResourceField> = {}
      for (const [key, field] of Object.entries(fields)) {
        if (field) present[key] = field
      }
      if (Object.keys(present).length === 0) continue
      merge(
        await ensureCustomFields(db, organizationId, entityType, defId, present, existing, state)
      )
    }

    // One call, and every edge resolves — see the "Why this is ONE migration"
    // note above. No rehydration block belongs here.
    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, [...NEW_TYPES], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

    // Panel and table field views are deliberately NOT seeded: their visibility
    // and order are computed live from the registry (`showInPanel` /
    // `showInTable` / `systemSortOrder`), so a default change stays code-only.
    // See the contract in `entity-seeder/create-field-views.ts`.
    //
    // The create dialogs ARE materialized — a dialog is an allowlist, which the
    // registry has no per-field way to express. Only the two header entities get
    // one: line entities are managed from their header, both payment entities
    // are inert and hidden, and `gl_account` / `gl_posting_line` are written
    // only by the poster.
    //
    // `purchase_order.number` and `vendor_bill.internalNumber` are absent by
    // design: both are `RecordSequence`-issued and `creatable: false`, so
    // offering either would be a box nobody may fill in. `vendor_bill.number`
    // IS present — it is the VENDOR's invoice number, typed by a human.
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'purchase_order',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: [
            'purchase_order_vendor',
            'purchase_order_ordered_at',
            'purchase_order_expected_at',
            'purchase_order_reference',
          ],
        },
        {
          entityType: 'vendor_bill',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: [
            'vendor_bill_vendor',
            'vendor_bill_number',
            'vendor_bill_purchase_order',
            'vendor_bill_billed_at',
            'vendor_bill_due_at',
          ],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    // The saved "All Purchase Orders" view, and "All Bills" plus the "Match
    // Exceptions" queue, for orgs that already exist (fresh orgs get them from
    // `entity-seeder/create-default-views.ts`, same configs). Idempotent — skips
    // if a TableView already exists for the entity. Nothing else gets one: the
    // line entities are hidden, and a hidden entity with no rows has nothing to
    // list — a seeded view is the kind of thing that grows a "create" button.
    for (const entityType of ['purchase_order', 'vendor_bill'] as const) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      await ensureDefaultTableViews(
        db,
        organizationId,
        systemUserId,
        entityType,
        defId,
        DEFAULT_VIEW_CONFIGS[entityType],
        allFieldMaps
      )
    }

    // ── Re-materialize the two status option sets ──────────────────────
    //
    // 🛑 `ensureCustomFields` SKIPS a field that already exists — it returns the
    // incumbent row and never touches its `options`. So changing an enum in
    // `enum-values.ts` reaches a fresh org (which seeds from the registry) and
    // silently does nothing for every org that already ran this migration. The
    // field keeps the values it was created with while the code, the types and
    // the UI all believe in the new list.
    //
    // Both directions of that have now bitten:
    //
    //   `vendor_bill_status`   gained `partially_paid`
    //   `purchase_order_status` LOST `partially_received` and `received`, which
    //                           moved to their own derived fields
    //                           (plans/purchasing/07-purchase-order-send-and-status.md §3.3)
    //
    // The whole array is rewritten rather than diffed, so the option ORDER
    // matches the registry everywhere — an appended value would sit last on
    // migrated orgs and mid-list on fresh ones, the kind of difference nobody
    // notices until two screenshots disagree. Safe because both fields are
    // `configurable: false`: there are no user-added options to preserve.
    //
    // ⚠️ Narrowing an option set orphans any `FieldValue.optionId` holding a
    // removed key. Deliberately NOT remapped here: 108 is the only migration
    // that has ever created `purchase_order_status`, it has run on local dev
    // orgs only, and the two values it drops never had a writer — so the orphan
    // set is a hand-set dev row or two, and `098-prune-orphaned-option-values`
    // is the pass that exists for orphans. A remap here would be permanent
    // machinery earning its keep exactly once.
    let statusRefreshed = false
    for (const [entityType, field] of [
      ['vendor_bill', VENDOR_BILL_FIELDS.status],
      ['purchase_order', PURCHASE_ORDER_FIELDS.status],
    ] as const) {
      const refreshed = await refreshStatusOptions(db, entityDefIds.get(entityType), field)
      statusRefreshed ||= refreshed
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 &&
      state.fieldsCreated === 0 &&
      state.relationshipsLinked === 0 &&
      !statusRefreshed

    // New definitions and fields are invisible to every read path until the
    // per-org caches that serve them are dropped. `runEntityMigrationsForOrg`
    // does this after the whole batch, but `up()` is also invoked directly (the
    // `scripts/run-migration-108.ts` door), so it clears its own.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
      logger.info('Migration 108 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}

/**
 * Bring one existing SINGLE_SELECT status field's options back in line with the
 * registry declaration it was seeded from.
 *
 * Reads the row rather than trusting `loadExistingState`'s snapshot or the
 * `allFieldMaps` entry: the snapshot is taken before this migration writes
 * anything, and the map carries the INCUMBENT options for a field that already
 * existed. Both would be correct here by accident; a fresh read is correct by
 * construction.
 *
 * Idempotent by comparison — returns `false` when the stored values already
 * match, so a second run reports `alreadyUpToDate` rather than dirtying the row
 * and re-invalidating the org cache on every pass. The comparison is on the
 * `value` keys in order, which is what `FieldValue.optionId` stores; a relabel
 * or recolour alone does not trigger a rewrite.
 *
 * @param defId the owning `EntityDefinition`, or undefined when the org has none
 * @param field the registry field whose `options.options` is the target state
 * @returns whether the row was actually rewritten.
 */
async function refreshStatusOptions(
  db: Database,
  defId: string | undefined,
  field: ResourceField | undefined
): Promise<boolean> {
  if (!defId) return false
  if (!field?.systemAttribute) return false

  const wanted = field.options?.options
  if (!wanted?.length) return false

  // Scoped in SQL to the def, then picked by attribute in JS. One query either
  // way — a `vendor_bill` carries ~28 fields — and it keeps the pick explicit
  // rather than resting on `[0]` of a filtered result.
  const rows = await db
    .select({
      id: schema.CustomField.id,
      systemAttribute: schema.CustomField.systemAttribute,
      options: schema.CustomField.options,
    })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, defId))

  const row = rows.find((candidate) => candidate.systemAttribute === field.systemAttribute)
  if (!row) return false

  const current = ((row.options as FieldOptions | null)?.options ?? []) as {
    value?: string
    label?: string
    color?: string
  }[]

  const sameValues =
    current.length === wanted.length &&
    current.every((option, index) => option.value === wanted[index]?.value)
  if (sameValues) return false

  await db
    .update(schema.CustomField)
    .set({
      options: { ...(row.options as FieldOptions), options: wanted },
      updatedAt: new Date(),
    })
    .where(eq(schema.CustomField.id, row.id))

  logger.info('Refreshed status options', {
    defId,
    systemAttribute: field.systemAttribute,
    from: current.length,
    to: wanted.length,
  })
  return true
}
