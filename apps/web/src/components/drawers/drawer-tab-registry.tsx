// apps/web/src/components/drawers/drawer-tab-registry.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
import type { ComponentType } from 'react'

/**
 * Props passed to all drawer tab components and tab card components
 */
export interface DrawerTabProps {
  /** Entity instance ID */
  entityInstanceId: string
  /** Full recordId (entityDefinitionId:entityInstanceId) */
  recordId: RecordId
  /** Record data (from useRecord) */
  record?: Record<string, unknown>
}

/**
 * Registry of drawer tab components
 * Maps "entityType:tabValue" → React component loader
 *
 * This lives in FRONTEND (apps/web) because:
 * - React components can't be in packages/lib
 * - Lazy loading with dynamic imports reduces bundle size
 */
export const DRAWER_TAB_COMPONENTS: Record<
  string,
  () => Promise<{ default: ComponentType<DrawerTabProps> }>
> = {
  // ─────────────────────────────────────────────────────────────────
  // CONTACT TABS
  // ─────────────────────────────────────────────────────────────────
  'contact:tickets': () =>
    import('./tabs/contact-tickets-tab').then((m) => ({ default: m.ContactTicketsTab })),
  'contact:conversations': () =>
    import('./tabs/contact-conversations-tab').then((m) => ({
      default: m.ContactConversationsTab,
    })),

  // ─────────────────────────────────────────────────────────────────
  // COMPANY TABS
  // ─────────────────────────────────────────────────────────────────
  'company:parts': () =>
    import('./tabs/company-parts-tab').then((m) => ({ default: m.CompanyPartsTab })),

  // ─────────────────────────────────────────────────────────────────
  // TICKET TABS
  // ─────────────────────────────────────────────────────────────────
  'ticket:conversation': () =>
    import('../detail-view/tabs/ticket-conversation-tab').then((m) => ({
      default: m.TicketConversationTab,
    })),

  // ─────────────────────────────────────────────────────────────────
  // PART TABS
  // ─────────────────────────────────────────────────────────────────
  'part:subparts': () =>
    import('./tabs/part-subparts-tab').then((m) => ({ default: m.PartSubpartsTab })),
  'part:vendors': () =>
    import('./tabs/part-vendors-tab').then((m) => ({ default: m.PartVendorsTab })),

  // ─────────────────────────────────────────────────────────────────
  // PRODUCT TABS
  // ─────────────────────────────────────────────────────────────────
  'product:parts': () =>
    import('./tabs/product-parts-tab').then((m) => ({ default: m.ProductPartsTab })),
}

/**
 * Registry of per-tab card components
 * Maps "entityType:cardValue" → React component loader
 * Used by BaseEntityDrawer to inject cards into base tabs (overview, timeline, etc.)
 */
export const DRAWER_TAB_CARD_COMPONENTS: Record<
  string,
  () => Promise<{ default: ComponentType<DrawerTabProps> }>
> = {
  // ─────────────────────────────────────────────────────────────────
  // CONTACT OVERVIEW CARDS
  // ─────────────────────────────────────────────────────────────────
  'contact:external-identities': () =>
    import('./cards/contact-external-identities-card').then((m) => ({
      default: m.ContactExternalIdentitiesCard,
    })),
  'contact:shared-with': () =>
    import('./cards/contact-shared-with-card').then((m) => ({
      default: m.ContactSharedWithCard,
    })),
  'contact:interactions': () =>
    import('./cards/record-interaction-card').then((m) => ({
      default: m.RecordInteractionCard,
    })),
  'company:interactions': () =>
    import('./cards/record-interaction-card').then((m) => ({
      default: m.RecordInteractionCard,
    })),
  'contact:billing': () =>
    import('./cards/contact-billing-overview-card').then((m) => ({
      default: m.ContactBillingOverviewCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // TICKET OVERVIEW CARDS
  // ─────────────────────────────────────────────────────────────────
  'ticket:metrics': () =>
    import('./cards/ticket-metrics-card').then((m) => ({ default: m.TicketMetricsCard })),
  'ticket:customer': () =>
    import('./cards/ticket-customer-card').then((m) => ({ default: m.TicketCustomerCard })),
  'ticket:relationships': () =>
    import('./cards/ticket-relationships-card').then((m) => ({
      default: m.TicketRelationshipsCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // PART OVERVIEW CARDS
  // ─────────────────────────────────────────────────────────────────
  'part:inventory': () =>
    import('./cards/part-inventory-tab').then((m) => ({ default: m.PartInventoryTab })),
  // Buy-vs-build comparison + the not-costed signal — renders nothing for a
  // part with a single cost candidate, hiding its whole section.
  'part:costing': () =>
    import('./cards/part-costing-card').then((m) => ({ default: m.PartCostingCard })),
  // Sellable toggle / pricing row — "sellable" is derived from the backing
  // catalog_item, never stored (plans/products/01-product-family.md §6.1).
  // Renders nothing for a part with no catalog item unless it's a finished good.
  'part:pricing': () =>
    import('./cards/part-pricing-card').then((m) => ({ default: m.PartPricingCard })),
  // Product-family membership + the finished-good suggestion — renders nothing
  // for a part with no `product` relation, hiding its whole section.
  'part:family': () =>
    import('./cards/part-family-card').then((m) => ({ default: m.PartFamilyCard })),

  // ─────────────────────────────────────────────────────────────────
  // PRODUCT OVERVIEW CARDS (shared with the product detail-view sidebar —
  // DetailViewSidebar reads from this same registry)
  // ─────────────────────────────────────────────────────────────────
  // Family shape: variant count, stock, price range, how many are priced.
  // Renders nothing for a family with no variants, hiding its whole section.
  'product:summary': () =>
    import('./cards/product-summary-card').then((m) => ({ default: m.ProductSummaryCard })),
  // The company behind the family (`product.vendor` → `company`, D9). Null on
  // most synced products — Shopify's brand string lands in an app field, and a
  // human links this relation — so the section is usually hidden.
  'product:vendor': () =>
    import('./cards/product-vendor-card').then((m) => ({ default: m.ProductVendorCard })),

  // ─────────────────────────────────────────────────────────────────
  // QUOTE OVERVIEW CARDS (shared with the quote detail-view sidebar —
  // DetailViewSidebar reads from this same registry, see detail-view-sidebar.tsx)
  // ─────────────────────────────────────────────────────────────────
  'quote:customer': () =>
    import('./cards/quote-customer-card').then((m) => ({ default: m.QuoteCustomerCard })),
  'quote:origin': () =>
    import('./cards/quote-origin-card').then((m) => ({ default: m.QuoteOriginCard })),
  'quote:jobs': () => import('./cards/quote-jobs-card').then((m) => ({ default: m.QuoteJobsCard })),
  // Deposit visibility (deposit-accounting plan 16 §D.5) — renders null when the quote has
  // no deposit charge, so most quotes show nothing extra.
  'quote:deposit': () =>
    import('./cards/quote-deposit-card').then((m) => ({ default: m.QuoteDepositCard })),
  // Drawer-only line-items block (the invoice:lines pattern) — the detail page
  // renders its own Line-items section via DETAIL_VIEW_TAB_COMPONENTS instead.
  'quote:lines': () =>
    import('../money/ui/quote/quote-line-items-tab').then((m) => ({
      default: m.QuoteLinesOverviewCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // SERVICE REQUEST OVERVIEW CARDS — uniform related-record blocks (work
  // orders + quotes) styled like the ticket customer block; the quotes block
  // carries header-parity "Create quote" (create-quote-action.tsx).
  // ─────────────────────────────────────────────────────────────────
  'service_request:work-orders': () =>
    import('./cards/service-request-related-cards').then((m) => ({
      default: m.ServiceRequestWorkOrdersCard,
    })),
  'service_request:quotes': () =>
    import('./cards/service-request-related-cards').then((m) => ({
      default: m.ServiceRequestQuotesCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // WORK ORDER OVERVIEW CARDS — Schedule (visits + schedule popover) + Invoices
  // (list + gather dialog), the service_request blocks applied to a job.
  // ─────────────────────────────────────────────────────────────────
  'work_order:schedule': () =>
    import('./cards/work-order-related-cards').then((m) => ({
      default: m.WorkOrderScheduleCard,
    })),
  'work_order:billing': () =>
    import('./cards/work-order-related-cards').then((m) => ({
      default: m.WorkOrderBillingCard,
    })),
  'work_order:communications': () =>
    import('../signals/ui/work-order-communications-card').then((m) => ({
      default: m.WorkOrderCommunicationsCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // BUILD OVERVIEW CARDS (plans/products/build/01-build-plan.md §3.6) — shared
  // with the build detail-view sidebar, which reads this same registry.
  // ─────────────────────────────────────────────────────────────────
  // The run's numbers plus the ONLY surface for Start / Cancel / Complete /
  // Reverse. `build_status` is `showInDialogs: false` and each transition is a
  // procedure with its own preconditions, so there is no status dropdown.
  'build:run': () =>
    import('../manufacturing/builds/build-run-card').then((m) => ({ default: m.BuildRunCard })),
  // The consume/produce rows the completion wrote. `build_movements` is
  // `showInPanel: false`, so this card is its only surface.
  'build:ledger': () =>
    import('../manufacturing/builds/build-ledger-card').then((m) => ({
      default: m.BuildLedgerCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // INVOICE OVERVIEW CARDS (money MI1 build spec §J.1 — drawer-only entity,
  // hasDetailPage: false, so these are the invoice's ONLY UI surface)
  // ─────────────────────────────────────────────────────────────────
  'invoice:lines': () =>
    import('../money/ui/invoice/invoice-lines-card').then((m) => ({
      default: m.InvoiceLinesCard,
    })),
  'invoice:payments': () =>
    import('../money/ui/invoice/invoice-payments-card').then((m) => ({
      default: m.InvoicePaymentsCard,
    })),
  'invoice:billing-context': () =>
    import('../money/ui/invoice/invoice-billing-context-card').then((m) => ({
      default: m.InvoiceBillingContextCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // ORDER OVERVIEW CARDS (plans/products/08-order-build.md §5.8) — unlike the
  // invoice, `order` also has a detail page (§5.7, D17); `order:lines` renders
  // the same component the page's Line-items section does, in `section` variant.
  // ─────────────────────────────────────────────────────────────────
  'order:lines': () =>
    import('../money/ui/order/order-line-items-tab').then((m) => ({
      default: m.OrderLinesOverviewCard,
    })),
  'order:customer': () =>
    import('./cards/order-customer-card').then((m) => ({ default: m.OrderCustomerCard })),
  'order:work-orders': () =>
    import('./cards/order-work-orders-card').then((m) => ({ default: m.OrderWorkOrdersCard })),

  // ─────────────────────────────────────────────────────────────────
  // PURCHASING CARDS — plans/purchasing/01-build-plan.md §4.4 / §5.1.
  // `vendor_bill:match` is the three-way-match verdict: billed, received and
  // expected side by side per line. Per §6.3 that IS the entire exception UI -
  // there is no bespoke screen behind it.
  // ─────────────────────────────────────────────────────────────────
  'purchase_order:lines': () =>
    import('../purchasing/purchase-order/purchase-order-lines-card').then((m) => ({
      default: m.PurchaseOrderLinesCard,
    })),
  'vendor_bill:lines': () =>
    import('../purchasing/vendor-bill/vendor-bill-lines-card').then((m) => ({
      default: m.VendorBillLinesCard,
    })),
  'vendor_bill:match': () =>
    import('../purchasing/vendor-bill/vendor-bill-match-card').then((m) => ({
      default: m.VendorBillMatchCard,
    })),
  // `receiving` is the ONLY read-back of `purchase_order_line_quantity_received`,
  // and `bills` the only surface for `purchase_order_bills` (`showInPanel: false`).
  'purchase_order:receiving': () =>
    import('../purchasing/purchase-order/purchase-order-receiving-card').then((m) => ({
      default: m.PurchaseOrderReceivingCard,
    })),
  'purchase_order:bills': () =>
    import('../purchasing/purchase-order/purchase-order-bills-card').then((m) => ({
      default: m.PurchaseOrderBillsCard,
    })),
  // One component behind both vendor keys — a PO and a bill each link exactly one
  // company and ask the same question of it.
  'purchase_order:vendor': () =>
    import('../purchasing/vendor-card').then((m) => ({ default: m.PurchaseOrderVendorCard })),
  'vendor_bill:vendor': () =>
    import('../purchasing/vendor-card').then((m) => ({ default: m.VendorBillVendorCard })),
  // The bill's six P12 payment fields. NOT the AR-side `invoice:payments` shape:
  // `vendor_payment` is inert under P13, so there are no payment records to list.
  'vendor_bill:payment': () =>
    import('../purchasing/vendor-bill/vendor-bill-payment-card').then((m) => ({
      default: m.VendorBillPaymentCard,
    })),

  // ─────────────────────────────────────────────────────────────────
  // WORK ORDER (job view) SIDEBAR CARDS — dispatch M2 build spec §F.2, shared
  // with the job view's DetailView sidebar (DetailViewSidebar reads from this
  // same registry, see detail-view-sidebar.tsx).
  // ─────────────────────────────────────────────────────────────────
  'work_order:customer-site': () =>
    import('./cards/work-order-customer-site-card').then((m) => ({
      default: m.WorkOrderCustomerSiteCard,
    })),
  'work_order:origin': () =>
    import('./cards/work-order-origin-card').then((m) => ({
      default: m.WorkOrderOriginCard,
    })),
}

/**
 * Drawer tab / overview-card values hidden in the restricted (read-only) drawer
 * — the customer-communication surfaces a field seat must never see on a linked
 * record (§11.4). Matched by either the bare tab/card value (`comments`) or the
 * qualified `entityType:value` form (`contact:conversations`). Tabs/cards NOT in
 * this set are unaffected, so full-member drawers stay byte-identical.
 */
const RESTRICTED_HIDDEN_DRAWER_TABS = new Set<string>([
  'comments',
  'contact:conversations',
  'work_order:communications',
])

/**
 * Whether a drawer tab or overview card is hidden in restricted (read-only) mode.
 * @param entityType - The frame's entity type (e.g. `contact`, `work_order`)
 * @param value - The tab or card value (e.g. `comments`, `conversations`)
 */
export function isRestrictedDrawerTab(entityType: string, value: string): boolean {
  return (
    RESTRICTED_HIDDEN_DRAWER_TABS.has(value) ||
    RESTRICTED_HIDDEN_DRAWER_TABS.has(`${entityType}:${value}`)
  )
}

/**
 * Get tab component loader for entityType and tab value
 * @returns Component loader or undefined if not found
 */
export function getTabComponent(
  entityType: string,
  tabValue: string
): (() => Promise<{ default: ComponentType<DrawerTabProps> }>) | undefined {
  const key = `${entityType}:${tabValue}`
  return DRAWER_TAB_COMPONENTS[key]
}

/**
 * Get tab card component loader for entityType and card value
 * @returns Component loader or undefined if not found
 */
export function getTabCardComponent(
  entityType: string,
  cardValue: string
): (() => Promise<{ default: ComponentType<DrawerTabProps> }>) | undefined {
  const key = `${entityType}:${cardValue}`
  return DRAWER_TAB_CARD_COMPONENTS[key]
}

/**
 * Check if a tab has a registered component
 */
export function hasTabComponent(entityType: string, tabValue: string): boolean {
  return `${entityType}:${tabValue}` in DRAWER_TAB_COMPONENTS
}
