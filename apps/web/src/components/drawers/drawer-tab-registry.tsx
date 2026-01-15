// apps/web/src/components/drawers/drawer-tab-registry.tsx
'use client'

import type { ComponentType } from 'react'

/**
 * Props passed to all drawer tab components
 */
export interface DrawerTabProps {
  /** Entity instance ID */
  entityInstanceId: string
  /** Full resourceId (entityDefinitionId:entityInstanceId) */
  resourceId: string
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
  // CUSTOM ENTITY TABS (future - when needed)
  // ─────────────────────────────────────────────────────────────────
  // 'custom:tasks': () =>
  //   import('./tabs/entity-tasks-tab').then((m) => ({ default: m.EntityTasksTab })),
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
 * Check if a tab has a registered component
 */
export function hasTabComponent(entityType: string, tabValue: string): boolean {
  return `${entityType}:${tabValue}` in DRAWER_TAB_COMPONENTS
}
