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

  // ─────────────────────────────────────────────────────────────────
  // QUOTE OVERVIEW CARDS (shared with the quote detail-view sidebar —
  // DetailViewSidebar reads from this same registry, see detail-view-sidebar.tsx)
  // ─────────────────────────────────────────────────────────────────
  'quote:customer': () =>
    import('./cards/quote-customer-card').then((m) => ({ default: m.QuoteCustomerCard })),
  'quote:origin': () =>
    import('./cards/quote-origin-card').then((m) => ({ default: m.QuoteOriginCard })),
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
