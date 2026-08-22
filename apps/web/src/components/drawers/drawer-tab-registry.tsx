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
  // Product-family membership + the finished-good suggestion — renders nothing
  // for a part with no `product` relation, hiding its whole section.
  'part:family': () =>
    import('./cards/part-family-card').then((m) => ({ default: m.PartFamilyCard })),

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
