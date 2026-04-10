// apps/web/src/components/detail-view/detail-view-tab-registry.tsx
'use client'

import type { ComponentType } from 'react'
import type { DetailViewTabProps } from './types'

/**
 * Registry of detail view tab components
 * Maps "entityType:tabValue" → React component loader
 *
 * This lives in FRONTEND (apps/web) because:
 * - React components can't be in packages/lib
 * - Lazy loading with dynamic imports reduces bundle size
 *
 * Supports wildcards with "*:tabValue" for universal tabs
 */
export const DETAIL_VIEW_TAB_COMPONENTS: Record<
  string,
  () => Promise<{ default: ComponentType<DetailViewTabProps> }>
> = {
  // ─────────────────────────────────────────────────────────────────
  // UNIVERSAL TABS (available for all entity types via wildcard)
  // ─────────────────────────────────────────────────────────────────
  '*:timeline': () => import('./tabs/timeline-tab').then((m) => ({ default: m.TimelineTab })),
  '*:tasks': () => import('./tabs/tasks-tab').then((m) => ({ default: m.TasksTab })),

  // ─────────────────────────────────────────────────────────────────
  // CONTACT TABS
  // ─────────────────────────────────────────────────────────────────
  'contact:tickets': () =>
    import('../drawers/tabs/contact-tickets-tab').then((m) => ({ default: m.ContactTicketsTab })),
  'contact:orders': () =>
    import('../drawers/tabs/contact-orders-tab').then((m) => ({ default: m.ContactOrdersTab })),

  // ─────────────────────────────────────────────────────────────────
  // TICKET TABS
  // ─────────────────────────────────────────────────────────────────
  'ticket:conversation': () =>
    import('./tabs/ticket-conversation-tab').then((m) => ({ default: m.TicketConversationTab })),

  // ─────────────────────────────────────────────────────────────────
  // PART TABS
  // ─────────────────────────────────────────────────────────────────
  'part:subparts': () =>
    import('../drawers/tabs/part-subparts-tab').then((m) => ({ default: m.PartSubpartsTab })),
}

/**
 * Get tab component loader for entityType and tab value
 * Checks for entity-specific first, then falls back to wildcard
 * @returns Component loader or undefined if not found
 */
export function getDetailViewTabComponent(
  entityType: string,
  tabValue: string
): (() => Promise<{ default: ComponentType<DetailViewTabProps> }>) | undefined {
  // Try entity-specific first
  const specificKey = `${entityType}:${tabValue}`
  if (DETAIL_VIEW_TAB_COMPONENTS[specificKey]) {
    return DETAIL_VIEW_TAB_COMPONENTS[specificKey]
  }

  // Fall back to wildcard
  const wildcardKey = `*:${tabValue}`
  return DETAIL_VIEW_TAB_COMPONENTS[wildcardKey]
}

/**
 * Check if a tab has a registered component
 */
export function hasDetailViewTabComponent(entityType: string, tabValue: string): boolean {
  const specificKey = `${entityType}:${tabValue}`
  const wildcardKey = `*:${tabValue}`
  return specificKey in DETAIL_VIEW_TAB_COMPONENTS || wildcardKey in DETAIL_VIEW_TAB_COMPONENTS
}
