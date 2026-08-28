// packages/lib/src/seed/entity-migrations/migrations/108-purchasing.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import { MATCHABLE_STATUSES, rematchBill } from '../../../purchasing/match-hook'
import type { ResourceField } from '../../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { GL_ACCOUNT_FIELDS } from '../../../resources/registry/resources/gl-account-fields'
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
import { seedDefaultChartOfAccounts } from '../../gl-account-chart'
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
}

/**
 * Pre-existing defs that receive fields here. `stock_movement` is the hard
 * dependency (checked separately); the rest are tolerated as absent, since an
 * org that has not reached the migration that seeds them has nothing to hang
 * an inverse off yet and a later run closes it.
 */
const EXISTING_TYPES = ['stock_movement', 'company', 'contact', 'part', 'vendor_part'] as const

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
}

/**
 * Migration 108: purchase-to-pay in one pass — receiving cost on
 * `stock_movement`, `purchase_order` + `purchase_order_line`, `vendor_bill` +
 * `vendor_bill_line`, the inert `vendor_payment` + `vendor_payment_allocation`
 * pair, and the `gl_account` chart
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
 *   stock_movement.glAccount            TEXT       the inventory ROLE (see below)
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
 * and `vendor_part` (stockMovements / purchaseOrderLines).
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
 * ## `stock_movement.glAccount` holds a ROLE, not a code (decision `G8`)
 *
 * This line said "the account CODE" when the migration was written, and the
 * field was written with `'1310'` / `'1330'` by `receiveStock`, `adjustStock`
 * and `completeBuild`. That is now wrong in both places and both are fixed
 * together, because a doc that disagrees with its writer is worse than either
 * one being wrong alone.
 *
 * `P2` keeps the ACCOUNTING PROVIDER's account ids out of the ledger. `G8` is
 * the same argument one level up and it is what `G7` forces: once the chart of
 * accounts is a seeded default the org **edits**, the account NUMBER cannot
 * carry the meaning either. A movement is append-only and its cost is frozen at
 * write time, so a `'1310'` stamped on a 2026 receipt is silently reinterpreted
 * the day someone renumbers Raw Materials — and the resulting posting still
 * balances, so nothing downstream can detect it. `buildReceiptEntry` already
 * consumes this field as `inventoryAccountRole`; it was the only half of the
 * pair that was right.
 *
 * `vendor_bill_line.glAccount` is deliberately the OPPOSITE and stays a CODE.
 * It is a bookkeeper coding a line against their own chart, most of which
 * carries no auxx role at all (16 of the 28 seeded accounts have none), and it
 * is `updatable: true` — nothing about it is frozen history. Same question,
 * different answer, for reasons stated at both declaration sites.
 *
 * The three codes that reached the field before the flip are remapped below.
 *
 * ## It re-derives every existing bill's verdict
 *
 * `vendor_bill_status` gained `awaiting_receipt` (P24), and that is not a new
 * value in a list — it changes what the STORED value means. A bill billed but
 * not yet received was an `exception`; it is `awaiting_receipt` now until the
 * order's `expectedAt` passes. Nothing else moves an existing bill: the nightly
 * aging sweep only reads bills already in `awaiting_receipt`, to age them
 * forward. So this migration re-runs `rematchBill` over every bill in a
 * matchable status, which re-derives status, variance and notes together — the
 * notes matter as much as the badge, because they are prose generated by a
 * reason code that no longer exists.
 *
 * **No cost backfill** (§2.5). Existing movements keep NULL cost and NULL
 * `occurredAt` and stay that way — they are not postable, and the fix for that
 * is the opening entry, not a reconstruction of what a past movement cost.
 *
 * **The chart of accounts IS seeded** (decision `G7`, `postings/default-chart.ts`).
 * That reverses this migration's original position, which was that "a guessed
 * chart in every org is worse than an empty one". What changed is `G8`: once a
 * builder posts to a ROLE and a resolver reads the org's own chart to turn that
 * role into a number, an EMPTY chart is not neutral — it is a resolver that
 * fails closed on every posting, and the org has no way to know which twelve
 * roles it was supposed to fill in. Seeding a default the org then edits is the
 * only shape where both `G7` and a working posting path are true.
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
    'vendor_payment / vendor_payment_allocation pair, and gl_account as a system ' +
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
    // are inert and hidden, and `gl_account` is written by the chart seed.
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

    // ── Re-materialize the three SELECT option sets ────────────────────
    //
    // 🛑 `ensureCustomFields` SKIPS a field that already exists — it returns the
    // incumbent row and never touches its `options`. So changing an enum in
    // `enum-values.ts` reaches a fresh org (which seeds from the registry) and
    // silently does nothing for every org that already ran this migration. The
    // field keeps the values it was created with while the code, the types and
    // the UI all believe in the new list.
    //
    // Both directions of that have now bitten, three times:
    //
    //   `vendor_bill_status`   gained `partially_paid`, and later
    //                           `awaiting_receipt` — the PREPAID case, which is
    //                           a correct bill and not a match exception (P24).
    //                           It is inserted BETWEEN `draft` and `matched`,
    //                           not appended, which is precisely why the whole
    //                           array is rewritten rather than diffed.
    //   `purchase_order_status` LOST `partially_received` and `received`, which
    //                           moved to their own derived fields
    //                           (plans/purchasing/07-purchase-order-send-and-status.md §3.3)
    //   `gl_account_role`       is new here, so `ensureCustomFields` writes its
    //                           twelve options — but the vocabulary is CLOSED
    //                           and grows as builders are written (the
    //                           fulfillment, payout, build and month-end
    //                           entries all still need roles), and every one of
    //                           those additions is an insert into the middle of
    //                           a grouped list. It joins the refresh now so the
    //                           next one is a one-line enum edit rather than a
    //                           migration nobody remembers to write.
    //
    // The whole array is rewritten rather than diffed, so the option ORDER
    // matches the registry everywhere — an appended value would sit last on
    // migrated orgs and mid-list on fresh ones, the kind of difference nobody
    // notices until two screenshots disagree. Safe because all three fields are
    // `configurable: false`: there are no user-added options to preserve.
    //
    // ⚠️ Narrowing an option set orphans any `FieldValue.optionId` holding a
    // removed key. Deliberately NOT remapped here: 108 is the only migration
    // that has ever created `purchase_order_status`, it has run on local dev
    // orgs only, and the two values it drops never had a writer — so the orphan
    // set is a hand-set dev row or two, and `098-prune-orphaned-option-values`
    // is the pass that exists for orphans. A remap here would be permanent
    // machinery earning its keep exactly once. Neither of the other two loses a
    // value at all: `awaiting_receipt` and the twelve roles are pure additions.
    let optionsRefreshed = false
    for (const [entityType, field] of [
      ['vendor_bill', VENDOR_BILL_FIELDS.status],
      ['purchase_order', PURCHASE_ORDER_FIELDS.status],
      ['gl_account', GL_ACCOUNT_FIELDS.role],
    ] as const) {
      const refreshed = await refreshSelectOptions(db, entityDefIds.get(entityType), field)
      optionsRefreshed ||= refreshed
    }

    // ── The org cache, dropped BEFORE anything writes a record ─────────
    //
    // 🛑 This flush is not tidying and its POSITION is the whole point. It used
    // to sit at the end of `up()`, after the chart seed, and that cost a full
    // pass: `UnifiedCrudHandler.warmCache` resolves an entity's fields from the
    // org cache, so the chart seed below ran against a `customFields` snapshot
    // taken BEFORE `gl_account_role` was created — and the handler DROPS a key
    // it cannot resolve rather than failing. The result was 784 accounts in 28
    // orgs with every field written except the one this migration had just
    // added, no error anywhere, and a migration log line reading "applied".
    //
    // So: definitions and fields first, then the flush, then anything that
    // writes a RECORD. Nothing that creates a field may run below this line.
    const structureChanged =
      state.entityDefsCreated > 0 ||
      state.fieldsCreated > 0 ||
      state.relationshipsLinked > 0 ||
      optionsRefreshed

    if (structureChanged) {
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
    }

    // ── The default chart of accounts ──────────────────────────────────
    //
    // Seeded after the flush, for the reason above, and after the option
    // refresh, because every role-carrying row writes `gl_account_role` and a
    // `CustomField` that does not yet carry the twelve options rejects the
    // value. Its own idempotency is on `code`.
    const chart = await seedDefaultChartOfAccounts(
      db,
      organizationId,
      entityDefIds.get('gl_account')
    )

    // ── stock_movement.glAccount: the code -> role remap ───────────────
    const rolesRemapped = await remapMovementAccountCodesToRoles(db, organizationId, allFieldMaps)

    // ── Re-derive every existing bill's verdict ────────────────────────
    const billsRematched = await rematchExistingBills(
      db,
      organizationId,
      systemUserId,
      entityDefIds.get('vendor_bill'),
      allFieldMaps
    )

    const alreadyUpToDate =
      !structureChanged && chart.created === 0 && rolesRemapped === 0 && billsRematched === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 108 applied', {
        organizationId,
        ...state,
        accountsSeeded: chart.created,
        movementRolesRemapped: rolesRemapped,
        billVerdictsChanged: billsRematched,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}

/**
 * Bring one existing SINGLE_SELECT field's options back in line with the
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
async function refreshSelectOptions(
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

  logger.info('Refreshed select options', {
    defId,
    systemAttribute: field.systemAttribute,
    from: current.length,
    to: wanted.length,
  })
  return true
}

/**
 * The account codes `stock_movement_gl_account` was written with before decision
 * `G8`, mapped to the roles it holds now.
 *
 * Exactly the three the old `GL_ACCOUNT_BY_PART_KIND` could produce, plus
 * `1320`: nothing ever wrote WIP (`partKind` has no value that maps to it), but
 * a hand-edited dev row is cheaper to cover than to rule out.
 *
 * 🛑 This is a translation table for values THIS codebase wrote, not a general
 * chart lookup. It must never grow to interpret an org's own numbering — that
 * is precisely the coupling `G8` exists to remove.
 */
const LEGACY_MOVEMENT_ACCOUNT_CODE_TO_ROLE: Readonly<Record<string, string>> = Object.freeze({
  '1310': 'inventory_raw_materials',
  '1320': 'inventory_wip',
  '1330': 'inventory_finished_goods',
})

/**
 * Rewrite every `stock_movement_gl_account` that still holds an account CODE
 * into the role it means.
 *
 * ## Why this is safe to do to an append-only ledger
 *
 * It is the one edit the append-only rule permits, because it changes no fact.
 * The movement said "this quantity sits in Raw Materials" before and says the
 * same thing after; only the vocabulary the sentence is written in changes. The
 * rule exists so that a *quantity* or a *cost* is never restated — and neither
 * is touched here.
 *
 * ## Why it is not a data migration of its own
 *
 * 108 created the field, 108 is the only migration that has ever written its
 * shape, and 108 has run on local dev orgs only (29 rows across all 28 orgs at
 * the time of writing). A separate id would be permanent machinery for a
 * one-time translation of dev data, and it would run AFTER the writers had
 * already been flipped, leaving a window where the field held both vocabularies.
 *
 * ## Why it is keyed on the exact three codes
 *
 * A value that is neither a known legacy code nor a known role is LEFT ALONE
 * and logged. Guessing at an unrecognised string is how a movement ends up
 * pointing at an account nobody chose; `buildReceiptEntry`'s resolver fails
 * closed on an unknown role, which is a loud failure and the correct one.
 *
 * Idempotent: a second pass matches nothing, because every value it wrote is a
 * role and no role is a key in the table above.
 *
 * @returns how many `FieldValue` rows were rewritten.
 */
async function remapMovementAccountCodesToRoles(
  db: Database,
  organizationId: string,
  allFieldMaps: Map<string, { id: string; systemAttribute: string }>
): Promise<number> {
  const field = [...allFieldMaps.values()].find(
    (f) => f.systemAttribute === 'stock_movement_gl_account'
  )
  if (!field) return 0

  const rows = await db
    .select({ id: schema.FieldValue.id, valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, field.id)
      )
    )

  let remapped = 0
  const unrecognised = new Set<string>()
  for (const row of rows) {
    if (!row.valueText) continue
    const role = LEGACY_MOVEMENT_ACCOUNT_CODE_TO_ROLE[row.valueText]
    if (!role) {
      // Already a role, or something nobody here wrote. Either way, not ours.
      if (!row.valueText.startsWith('inventory_')) unrecognised.add(row.valueText)
      continue
    }
    await db
      .update(schema.FieldValue)
      .set({ valueText: role, updatedAt: new Date() })
      .where(eq(schema.FieldValue.id, row.id))
    remapped++
  }

  if (unrecognised.size > 0) {
    logger.warn('Left an unrecognised stock_movement_gl_account value alone', {
      organizationId,
      values: [...unrecognised],
    })
  }
  if (remapped > 0) {
    logger.info('Remapped stock_movement_gl_account codes to roles', { organizationId, remapped })
  }
  return remapped
}

/**
 * Re-run the three-way match over every bill that already has a verdict, so the
 * stored verdict means what the CURRENT rule says it means.
 *
 * ## Why a migration that adds an option also has to do this
 *
 * `P24` did not add a value to a list — it changed what `vendor_bill_status`
 * MEANS. A bill that is billed but not yet received used to be an `exception`;
 * it is now `awaiting_receipt`, and becomes a real exception only once the
 * purchase order's `expectedAt` has passed. Every bill already in the database
 * carries a verdict computed under the old rule, and nothing else re-derives it:
 *
 *  - materialising the option changes no stored value;
 *  - the nightly aging sweep selects only bills ALREADY in `awaiting_receipt`,
 *    to age them FORWARD into `exception`. It never reads an `exception` bill,
 *    so it cannot move one back.
 *
 * Without this step the change is invisible where it matters: a bill against a
 * purchase order that is not due for another twelve days keeps rendering a red
 * **Exception** badge, which is the exact false positive `P24` exists to
 * delete. `vendor_bill_match_variance` and `vendor_bill_match_notes` are stale
 * in the same way — the notes are prose generated by a reason code that no
 * longer exists ("billed 1 but only 0 received").
 *
 * A migration that changes the meaning of a stored DERIVED value owns
 * re-deriving it. That is the rule this step keeps.
 *
 * ## How
 *
 * `rematchBill` is reused rather than reimplemented — it re-derives status,
 * variance and notes TOGETHER, which is what stops the notes lying, and it
 * skips the write when the verdict is unchanged, so this is cheap and
 * idempotent. A second definition of the verdict here would be free to drift
 * from the one the app runs.
 *
 * ⚠️ It must run AFTER the option refresh and AFTER the org-cache flush.
 * `rematchBill` resolves `customFields` from the cache and writes a
 * SINGLE_SELECT; writing `awaiting_receipt` against a cached option list that
 * does not contain it is how a raw unlabelled string reaches the screen.
 *
 * Isolated per bill: one bill that cannot be matched is logged and skipped, not
 * allowed to fail-stop the org's whole migration.
 *
 * @returns how many bills' stored status actually changed.
 */
async function rematchExistingBills(
  db: Database,
  organizationId: string,
  userId: string,
  vendorBillDefId: string | undefined,
  allFieldMaps: Map<string, { id: string; systemAttribute: string }>
): Promise<number> {
  if (!vendorBillDefId) return 0

  const fieldId = (systemAttribute: string) =>
    [...allFieldMaps.values()].find((f) => f.systemAttribute === systemAttribute)?.id

  const statusFieldId = fieldId('vendor_bill_status')
  if (!statusFieldId) return 0

  // 🛑 The verdict is THREE fields, not one, so the change count watches all
  // three. `rematchBill` re-derives status, variance and notes together, and the
  // notes are the half that lies loudest: BILL-0005 kept its `exception` status
  // through this migration (it has real price variances) while its notes shed
  // two "billed 1 but only 0 received" clauses written by a reason code P24
  // deleted. Counting only the status would have called that run a no-op.
  const verdictFieldIds = [
    statusFieldId,
    fieldId('vendor_bill_match_variance'),
    fieldId('vendor_bill_match_notes'),
  ].filter((id): id is string => !!id)

  const bills = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.entityDefinitionId, vendorBillDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (bills.length === 0) return 0
  const billIds = bills.map((bill) => bill.id)

  // One read of every stored verdict cell, so "did anything change" is a
  // comparison rather than a guess. A SINGLE_SELECT stores its value in
  // `optionId`; `valueText` is the fallback for a row written before the field
  // was a select, and `valueNumber` carries the variance.
  const readVerdicts = async () => {
    const rows = await db
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        optionId: schema.FieldValue.optionId,
        valueText: schema.FieldValue.valueText,
        valueNumber: schema.FieldValue.valueNumber,
      })
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.fieldId, verdictFieldIds),
          inArray(schema.FieldValue.entityId, billIds)
        )
      )
    const status = new Map<string, string | null>()
    const verdict = new Map<string, string>()
    for (const row of rows) {
      const cell = `${row.fieldId}=${row.optionId ?? row.valueText ?? row.valueNumber ?? ''}`
      verdict.set(row.entityId, `${verdict.get(row.entityId) ?? ''}|${cell}`)
      if (row.fieldId === statusFieldId) {
        status.set(row.entityId, row.optionId ?? row.valueText ?? null)
      }
    }
    return { status, verdict }
  }

  const before = await readVerdicts()

  // Only the statuses a recomputed match may overwrite. `posted`, `paid` and
  // `void` are settled facts about a document that has already left this
  // system. `rematchBill` enforces this itself; selecting on it here keeps the
  // migration's own intent visible rather than resting on another module's
  // early return.
  const candidates = billIds.filter((id) => {
    const status = before.status.get(id)
    return !status || MATCHABLE_STATUSES.has(status)
  })
  if (candidates.length === 0) return 0

  for (const vendorBillInstanceId of candidates) {
    try {
      await rematchBill({ organizationId, userId, vendorBillInstanceId, db })
    } catch (error) {
      // One unmatchable bill is a data problem on that bill. Failing the org's
      // migration over it would block every other org-level change behind it.
      logger.warn('Could not re-run the match for a bill; leaving its verdict alone', {
        organizationId,
        vendorBillInstanceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const after = await readVerdicts()
  let changed = 0
  for (const id of candidates) {
    if ((before.verdict.get(id) ?? null) !== (after.verdict.get(id) ?? null)) changed++
  }

  if (changed > 0) {
    logger.info('Re-derived vendor bill verdicts under the current match rule', {
      organizationId,
      considered: candidates.length,
      changed,
      statusChanged: candidates.filter(
        (id) => (before.status.get(id) ?? null) !== (after.status.get(id) ?? null)
      ).length,
    })
  }
  return changed
}
