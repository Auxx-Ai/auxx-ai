// packages/lib/src/resources/registry/ledger-blocks.ts

import type { LayoutBlock } from './block-types'

/**
 * The Purchasing (company) and Billing (contact) tabs
 * (`plans/drawer/record-layout-system.md` §4, §11).
 *
 * Same machinery, opposite ledgers, so they carry different labels: a company
 * is the party we BUY from, and its tab is accounts payable (purchase orders,
 * vendor bills, plus the jobs raised against it); a contact is the party we
 * SELL to, and its tab is accounts receivable (quotes, invoices, jobs, and the
 * buy-side orders addressed to them). "Billing" on both would have named two
 * opposite ledgers with one word.
 *
 * Declared once and consumed by BOTH registries (`DRAWER_CONFIG_REGISTRY` and
 * `DETAIL_VIEW_CONFIG_REGISTRY`), because §10 names "two registries drifting"
 * as a top risk and a shared block has to land on both surfaces at once. Sharing
 * the array makes agreement structural rather than something a test has to catch
 * after the fact (`drawer-card-parity.test.ts` asserts it anyway).
 *
 * **Why every section is a `query` source and not a `relation` one.** Both reads
 * exist and the choice is per section (§4, §10). Every one of these five is an
 * inverse relationship mirror, which is unordered and uncapped:
 * `contact_work_orders` has been measured at 475 entries from 5 records
 * (`packages/lib/src/field-values/sweep-entity-references.ts`). Unordered is the
 * decisive half: capping the render of an unordered mirror shows an ARBITRARY
 * ten of a customer's four hundred jobs, which is worse than showing none. All
 * five lists grow with transaction volume, so all five need a server sort and a
 * bounded page. The `relation` source stays right for a list bounded by its
 * parent document (a quote's jobs, a purchase order's bills), none of which is
 * here.
 *
 * Gating is per section via `recordResource`, never one gate on the tab: a
 * viewer who cannot read `vendor_bill` loses the Vendor bills section and keeps
 * the rest, and a viewer who can read none of them loses the tab entirely
 * because tab visibility is derived from its blocks (§7).
 */

/** Rows shown before the "Show N more" toggle in a ledger section. */
const LEDGER_VISIBLE_LIMIT = 5

/** Server page size behind a ledger section. Not a cap on what exists. */
const LEDGER_PAGE_SIZE = 20

/**
 * Page size for a list bounded by its parent record rather than by transaction
 * volume. Comfortably above the largest dispatch in the dev data (31 boxes).
 */
const PARCEL_PAGE_SIZE = 100

/** Newest first: the same default `queryEntityInstanceIdsPaged` falls back to. */
const NEWEST_FIRST = { fieldId: 'createdAt', desc: true } as const

/** Tab value of the company's accounts-payable tab. */
export const PURCHASING_TAB_ID = 'purchasing'

/** Tab value of the contact's accounts-receivable tab. */
export const BILLING_TAB_ID = 'billing'

/**
 * One ledger section, with the parts that are identical across all seven filled
 * in. Keeps each entry below to the five facts that actually differ.
 */
function ledgerBlock(input: {
  /** Block id. Namespaced by host entity type so company and contact never collide. */
  id: string
  label: string
  icon: string
  /** Target definition slug, which is also the section's Layer-3 read gate. */
  definition: string
  /** Forward field on the TARGET pointing back at the host, in `def:field` form. */
  hostFieldId: string
  /** System attribute on the target whose value renders as the row's badge. */
  statusAttr?: string
  emptyLabel: string
  /**
   * Server sort, when {@link NEWEST_FIRST} is the wrong column.
   *
   * `createdAt` is when the ROW was written, which for an imported document is
   * when the sync ran, not when the document happened. A definition that
   * carries its own real date (`order.placedAt`) has to name it, or a bulk
   * backfill orders the list by import order.
   */
  sort?: { fieldId: string; desc?: boolean }
  /**
   * Server page size, when {@link LEDGER_PAGE_SIZE} is too small.
   *
   * A page is not a render cap (`visibleLimit` is), but it IS a hard ceiling on
   * what "Show N more" can ever reveal, with nothing on screen to say so. 20 is
   * right for a list that grows forever with transaction volume, where a
   * customer reads the newest page and filters for the rest. It is wrong for a
   * list bounded by its parent document: the dev data already carries a 31-box
   * shipment, and at 20 eleven of those boxes would be unreachable from the
   * drawer entirely.
   */
  pageSize?: number
  /**
   * Name in `BLOCK_ACTIONS_COMPONENTS` for a section-level action.
   *
   * Section-level, NOT per-row: `RecordsBlockConfig` cannot express a per-row
   * input or selector, and this does not change that. Omitted means a pure-read
   * section, which is what every ledger block below the contact and company
   * tabs wants.
   */
  actionsComponent?: string
}): LayoutBlock {
  return {
    id: input.id,
    kind: 'records',
    label: input.label,
    icon: input.icon,
    // A section that lists another definition's records gates on that
    // definition's read level, exactly as a card's `recordResource` does.
    recordResource: input.definition,
    config: {
      source: {
        kind: 'query',
        definition: input.definition,
        hostFieldId: input.hostFieldId,
        sort: input.sort ?? NEWEST_FIRST,
        pageSize: input.pageSize ?? LEDGER_PAGE_SIZE,
      },
      statusAttr: input.statusAttr,
      emptyLabel: input.emptyLabel,
      visibleLimit: LEDGER_VISIBLE_LIMIT,
      ...(input.actionsComponent ? { actionsComponent: input.actionsComponent } : {}),
    },
  }
}

/**
 * The company's Purchasing tab: its next order and supply performance, what we
 * buy from this company, what it billed us, the jobs raised against it, and the
 * MRP ordering settings.
 *
 * Ordered by ledger flow (order, then bill), with work orders last because a
 * company is a supplier here, and jobs are the one non-payable list.
 */
export const COMPANY_PURCHASING_BLOCKS: LayoutBlock[] = [
  // The supplier's MRP blocks (plans/mrp/07-ui-plan.md D28): what to act on first, settings last.
  {
    id: 'card:mrp-next-order',
    kind: 'card',
    cardValue: 'mrp-next-order',
    label: 'Next order',
    icon: 'shopping-cart',
    permissionKey: 'mrp.view',
  },
  {
    id: 'card:mrp-supply',
    kind: 'card',
    cardValue: 'mrp-supply',
    label: 'Supply performance',
    icon: 'truck',
    permissionKey: 'mrp.view',
  },
  ledgerBlock({
    id: 'company:purchase-orders',
    label: 'Purchase orders',
    icon: 'shopping-cart',
    definition: 'purchase_order',
    // `purchase_order.vendor` is the supplier side, required on every PO.
    hostFieldId: 'purchase_order:vendor',
    statusAttr: 'purchase_order_status',
    emptyLabel: 'No purchase orders',
  }),
  ledgerBlock({
    id: 'company:vendor-bills',
    label: 'Vendor bills',
    icon: 'receipt',
    definition: 'vendor_bill',
    hostFieldId: 'vendor_bill:vendor',
    statusAttr: 'vendor_bill_status',
    emptyLabel: 'No bills',
  }),
  ledgerBlock({
    id: 'company:work-orders',
    label: 'Work orders',
    icon: 'wrench',
    definition: 'work_order',
    hostFieldId: 'work_order:company',
    statusAttr: 'work_order_status',
    emptyLabel: 'No work orders',
  }),
  {
    id: 'card:mrp-ordering',
    kind: 'card',
    cardValue: 'mrp-ordering',
    label: 'Ordering settings',
    icon: 'calendar-clock',
    permissionKey: 'mrp.view',
  },
]

/**
 * The contact's Billing tab: what we quoted them, what we billed them, the jobs
 * behind it, and the purchase orders addressed to them.
 *
 * Ordered as the receivable ledger reads: quote, invoice, then the work behind
 * it. Purchase orders come last deliberately, because `purchase_order.contact` is the
 * ADDRESSEE at a vendor, the one buy-side list on an otherwise sell-side tab,
 * and it is empty for almost every contact.
 */
export const CONTACT_BILLING_BLOCKS: LayoutBlock[] = [
  ledgerBlock({
    id: 'contact:quotes',
    label: 'Quotes',
    icon: 'file-text',
    definition: 'quote',
    hostFieldId: 'quote:contact',
    statusAttr: 'quote_status',
    emptyLabel: 'No quotes',
  }),
  ledgerBlock({
    id: 'contact:invoices',
    label: 'Invoices',
    icon: 'receipt-text',
    definition: 'invoice',
    hostFieldId: 'invoice:contact',
    statusAttr: 'invoice_status',
    emptyLabel: 'No invoices',
  }),
  ledgerBlock({
    id: 'contact:work-orders',
    label: 'Work orders',
    icon: 'wrench',
    definition: 'work_order',
    hostFieldId: 'work_order:contact',
    statusAttr: 'work_order_status',
    emptyLabel: 'No work orders',
  }),
  ledgerBlock({
    id: 'contact:purchase-orders',
    label: 'Purchase orders',
    icon: 'shopping-cart',
    definition: 'purchase_order',
    hostFieldId: 'purchase_order:contact',
    statusAttr: 'purchase_order_status',
    emptyLabel: 'No purchase orders',
  }),
  // What this customer sent back (plans/money/tasks/54-returns.md section 10,
  // step 8). Lands on the drawer and the detail page at once, because both
  // configs read this one list.
  //
  // ⚠️ Only IDENTIFIED returns appear here, and that is correct rather than a
  // gap: `return.contact` is nullable precisely so a pallet that turns up on
  // the dock with no RMA can be recorded before anyone knows whose it is
  // (section 3.2). An unidentified return has no contact to hang under. The
  // queue for those is the saved view on `contact IS NULL`, not this section.
  ledgerBlock({
    id: 'contact:returns',
    label: 'Returns',
    icon: 'package-x',
    definition: 'return',
    hostFieldId: 'return:contact',
    statusAttr: 'return_status',
    emptyLabel: 'No returns',
  }),
]

/**
 * Orders on the CONTACT overview (not the Billing tab).
 *
 * The one sell-side list that is not a billing document: for a store, an order
 * IS the reason the person is writing in, so it sits on the first tab a support
 * agent lands on rather than three clicks away under Billing. Placed with no
 * `position`, so it renders after the Details panel and the two overview cards,
 * which is where a list belongs on a tab that leads with identity fields.
 *
 * 🔑 The badge is `order_fulfillment_status`, NOT `order_financial_status`.
 * `order` is the only definition here with two status fields and
 * `RecordsBlockConfig.statusAttr` is singular, so this is a choice: by the time
 * a customer emails, they have almost always paid, and what they are asking is
 * whether it shipped. The money side stays one click away on the record.
 *
 * ⚠️ Sorted by `placedAt`, not the shared `createdAt` default. `createdAt` is
 * when WE wrote the row, so a bulk import would order a customer's history by
 * sync order. `placedAt` is nullable and the query builder applies
 * `NULLS LAST` in both directions, so a manually raised order with no date
 * sinks below the real ones rather than pinning itself to the top.
 */
export const CONTACT_ORDERS_BLOCKS: LayoutBlock[] = [
  ledgerBlock({
    id: 'contact:orders',
    label: 'Orders',
    icon: 'shopping-bag',
    definition: 'order',
    // `order.contact` is required on every order — the buying party.
    hostFieldId: 'order:contact',
    statusAttr: 'order_fulfillment_status',
    emptyLabel: 'No orders',
    sort: { fieldId: 'placedAt', desc: true },
    actionsComponent: 'contact-orders',
  }),
]

/**
 * Returns on the TICKET drawer (plans/money/tasks/54-returns.md section 4.1).
 *
 * 🔑 This is the feature's main creation route, not a read-only list. The
 * owner's instruction was "we have a button to create a ticket from a thread,
 * that should be the main route, and from the ticket drawer we create or link a
 * return, so we don't invent new buttons" - so the section carries an
 * `actionsComponent`, and `ticket.returns` deliberately stays
 * `showInPanel: false` rather than becoming a field-panel row.
 *
 * 🛑 The product's FIRST consumer of `actionsComponent`. Every other
 * list-with-an-Add-button today is a bespoke `CardBlock`; the seam was built in
 * stage 1 and left empty on purpose. It was proved end to end against the real
 * `RecordListBlock` before this shipped - see
 * `apps/web/src/components/tickets/ticket-returns-block-seam.test.tsx`, which
 * pins that the action renders after the `EmptyRow` (the ticket-with-no-return
 * case, which is the one that matters).
 */
export const TICKET_RETURNS_BLOCKS: LayoutBlock[] = [
  ledgerBlock({
    id: 'ticket:returns',
    label: 'Returns',
    icon: 'package-x',
    definition: 'return',
    hostFieldId: 'return:ticket',
    statusAttr: 'return_status',
    emptyLabel: 'No returns',
    actionsComponent: 'ticket-returns',
  }),
]

/**
 * Fulfillments on the ORDER drawer overview: every shipment the order produced,
 * in sequence. A `query` source for the order, not the mirror, because
 * `order_fulfillments` is unordered; bounded by its order, so one page holds all.
 */
export const ORDER_FULFILLMENTS_BLOCKS: LayoutBlock[] = [
  ledgerBlock({
    id: 'order:fulfillments',
    label: 'Fulfillments',
    icon: 'truck',
    definition: 'fulfillment',
    hostFieldId: 'fulfillment:order',
    statusAttr: 'fulfillment_status',
    emptyLabel: 'Nothing shipped yet',
    sort: { fieldId: 'sequence' },
    pageSize: PARCEL_PAGE_SIZE,
  }),
]

/** What one fulfillment shipped: each row is the order line and the quantity it carried. */
export const FULFILLMENT_LINES_BLOCKS: LayoutBlock[] = [
  ledgerBlock({
    id: 'fulfillment:lines',
    label: 'Shipped lines',
    icon: 'package-check',
    definition: 'fulfillment_line',
    hostFieldId: 'fulfillment_line:fulfillment',
    // The row's badge slot prints a non-option value raw, so it carries the count.
    statusAttr: 'fulfillment_line_quantity',
    emptyLabel: 'No lines',
    pageSize: PARCEL_PAGE_SIZE,
  }),
]

/**
 * Parcels on the SHIPMENT drawer overview.
 *
 * A shipment is a dispatch and a parcel is one physical box with one tracking
 * number, and "where is my box" is the question a support agent opens a
 * shipment to answer. So the boxes lead the overview rather than living behind
 * the `shipment.parcels` mirror in the Details panel, which is why that field
 * is `showInPanel: false`.
 *
 * `shipment` is DRAWER-ONLY: it has no `DETAIL_VIEW_CONFIG_REGISTRY` entry and
 * no `[shipmentId]/` route (`app/shipments/page.tsx`), so unlike the contact's
 * Orders section this needs no mirrored declaration on the detail registry.
 * `drawer-card-parity.test.ts` compares only entity types the detail registry
 * knows about. If a shipment detail page is ever added, that test starts
 * demanding this block on both surfaces.
 *
 * ⚠️ Sorted by `sequence` ASCENDING, not the shared `createdAt DESC` default.
 * Two reasons, both in `parcel-fields.ts`: array position carries no meaning
 * (the ShipStation probe observed a three-box label returned in sequence order
 * 3, 2, 1), and boxes read naturally 1..n rather than newest-first. `sequence`
 * is nullable and the query builder applies `NULLS LAST` in both directions, so
 * a box whose sequence was never written sinks below the real ones.
 *
 * ⚠️ VOIDED parcels are listed, and their badge can lie. `shipment.status`
 * excludes voided parcels from its roll-up entirely, but a `RecordsQuerySource`
 * filters on `hostFieldId` alone and has no room for a second condition, and
 * probe §3 found voided labels still reporting `tracking_status: in_transit`.
 * Listing them is the deliberate choice (owner, 2026-09-14): a voided box is
 * still part of the relabel history an agent is looking at, and hiding it would
 * make a three-box shipment render two boxes with no explanation. Excluding it
 * would mean adding an optional filter to the shared block model, which is a
 * change worth making for a second consumer, not this one.
 */
export const SHIPMENT_PARCELS_BLOCKS: LayoutBlock[] = [
  ledgerBlock({
    id: 'shipment:parcels',
    label: 'Parcels',
    icon: 'package',
    definition: 'parcel',
    // `parcel.shipment` is the belongs_to side: the dispatch this box was in.
    hostFieldId: 'parcel:shipment',
    // Null on every row today, so no badge renders (the attribute resolver
    // returns undefined and `RelatedRecordRow` skips the Badge). Not an
    // oversight: a ShipStation package carries no status field at all, so the
    // connector deliberately declines to write this and puts the label's
    // one value in a hidden app field instead. The writer is the outstanding
    // `/v2/tracking` stream in
    // `plans/apps/shipstation/shipstation-tracking-stream-plan.md`.
    statusAttr: 'parcel_status',
    emptyLabel: 'No parcels',
    sort: { fieldId: 'sequence' },
    // Every box, not the first 20. A parcel list is bounded by its shipment
    // rather than by transaction volume, and the dev data's largest dispatch is
    // 31 boxes, so the shared page would have hidden eleven of them behind a
    // "Show 15 more" that stops at 20 and says nothing. Only `visibleLimit`
    // rows render until the viewer expands, so the row fan-out is unchanged for
    // the 87% of shipments carrying three boxes or fewer.
    pageSize: PARCEL_PAGE_SIZE,
  }),
]
