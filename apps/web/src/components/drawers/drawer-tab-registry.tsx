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
  'contact:orders': () =>
    import('./tabs/contact-orders-tab').then((m) => ({ default: m.ContactOrdersTab })),
  'contact:conversations': () =>
    import('./tabs/contact-conversations-tab').then((m) => ({
      default: m.ContactConversationsTab,
    })),
  'contact:parts': () =>
    import('./tabs/contact-parts-tab').then((m) => ({ default: m.ContactPartsTab })),

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
    import('./cards/part-inventory-card').then((m) => ({ default: m.PartInventoryCard })),
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
