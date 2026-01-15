// packages/lib/src/resources/registry/drawer-config.ts

import type { DrawerConfig, DrawerConfigRegistry } from './drawer-config-types'

/**
 * Drawer configuration registry
 * ONLY contains drawer-specific config (tabs, actions)
 * - Tab metadata (value, label, icon) - NOT React components
 * - Action capabilities
 *
 * Entity metadata (label, icon, color) comes from Resource via useResource
 * React components mapped in frontend via drawer-tab-registry.tsx
 *
 * NOTE: Tickets use specialized TicketDetailDrawer (not EntityDrawer)
 * Ticket config below is for reference/documentation only
 */
export const DRAWER_CONFIG_REGISTRY: DrawerConfigRegistry = {
  contact: {
    entityType: 'contact',
    additionalTabs: [
      { value: 'tickets', label: 'Tickets', icon: 'ticket' },
      { value: 'orders', label: 'Orders', icon: 'shopping-bag' },
      { value: 'conversations', label: 'Conversations', icon: 'mail' },
      { value: 'parts', label: 'Parts', icon: 'package' },
    ],
    actions: {
      enableEmailCompose: true,
      enableMerge: true,
      enableGroups: true,
      enableArchive: true,
      enableDelete: true,
    },
  },

  // Tickets use specialized TicketDetailDrawer (not EntityDrawer)
  // This config is for documentation/consistency only - not actually used
  ticket: {
    entityType: 'ticket',
    additionalTabs: [], // TicketDetailDrawer has hardcoded tabs (overview, conversations, timeline, comments)
    actions: {
      // These actions exist in TicketDetailDrawer but aren't driven by this config
      enableEmailCompose: true, // Reply button
      enableAssign: true, // Assignment management
      enableMerge: true, // Merge dialog
      enableArchive: true, // Archive action
      enableDelete: true, // Delete action
    },
  },

  part: {
    entityType: 'part',
    additionalTabs: [
      { value: 'inventory', label: 'Inventory', icon: 'package' },
      { value: 'subparts', label: 'Subparts', icon: 'layers' },
      { value: 'vendors', label: 'Vendors', icon: 'truck' },
    ],
    actions: {
      enableArchive: true,
      enableDelete: true,
    },
  },
}

/**
 * Get drawer configuration for entity type
 * Returns ONLY drawer-specific config (tabs, actions)
 * Entity metadata comes from Resource object
 */
export function getEntityDrawerConfig(
  entityType: string,
  entityDefinitionId?: string
): DrawerConfig {
  // System entity - use predefined config
  if (DRAWER_CONFIG_REGISTRY[entityType]) {
    return DRAWER_CONFIG_REGISTRY[entityType]!
  }

  // Custom entity - return generic config (drawer-specific only)
  return {
    entityType: entityDefinitionId ?? entityType,
    additionalTabs: [],
    actions: {
      enableArchive: true,
      enableDelete: true,
    },
  }
}

export function hasDrawerConfig(entityType: string): boolean {
  return entityType in DRAWER_CONFIG_REGISTRY
}
