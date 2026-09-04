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
  statusAttr: string
  emptyLabel: string
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
        sort: NEWEST_FIRST,
        pageSize: LEDGER_PAGE_SIZE,
      },
      statusAttr: input.statusAttr,
      emptyLabel: input.emptyLabel,
      visibleLimit: LEDGER_VISIBLE_LIMIT,
    },
  }
}

/**
 * The company's Purchasing tab: what we buy from this company, what it billed
 * us, and the jobs raised against it.
 *
 * Ordered by ledger flow (order, then bill), with work orders last because a
 * company is a supplier here, and jobs are the one non-payable list.
 */
export const COMPANY_PURCHASING_BLOCKS: LayoutBlock[] = [
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
]
