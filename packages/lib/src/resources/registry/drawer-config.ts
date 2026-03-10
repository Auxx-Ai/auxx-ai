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

  ticket: {
    entityType: 'ticket',
    additionalTabs: [{ value: 'conversations', label: 'Conversations', icon: 'mail' }],
    actions: {
      enableEmailCompose: true,
      enableEdit: true,
      enableRename: true,
      enableMerge: true,
      enableArchive: true,
      enableLink: true,
      enableDelete: true,
    },
    tabCards: {
      overview: [
        { value: 'metrics', label: 'Metrics', position: 'before' },
        { value: 'customer', label: 'Customer' },
        { value: 'relationships', label: 'Related Tickets' },
      ],
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
