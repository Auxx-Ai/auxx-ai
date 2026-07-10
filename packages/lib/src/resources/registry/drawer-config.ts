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
      { value: 'conversations', label: 'Conversations', icon: 'mail' },
    ],
    actions: {
      enableMerge: true,
      enableGroups: true,
      enableArchive: true,
      enableDelete: true,
    },
  },

  company: {
    entityType: 'company',
    additionalTabs: [{ value: 'parts', label: 'Parts', icon: 'package' }],
    actions: {
      enableArchive: true,
      enableDelete: true,
    },
  },

  ticket: {
    entityType: 'ticket',
    additionalTabs: [{ value: 'conversation', label: 'Conversation', icon: 'mail' }],
    actions: {
      enableEdit: true,
      enableRename: true,
      enableMerge: true,
      enableArchive: true,
      enableLink: true,
      enableDelete: true,
    },
    tabCards: {
      overview: [
        { value: 'metrics', label: 'Metrics', position: 'before', fullBleed: true },
        { value: 'customer', label: 'Customer' },
        { value: 'relationships', label: 'Related Tickets' },
      ],
    },
  },

  part: {
    entityType: 'part',
    additionalTabs: [
      { value: 'subparts', label: 'Subparts', icon: 'layers' },
      { value: 'vendors', label: 'Suppliers', icon: 'truck' },
    ],
    actions: {
      enableArchive: true,
      enableDelete: true,
    },
    tabCards: {
      overview: [{ value: 'inventory', label: 'Inventory' }],
    },
  },

  quote: {
    entityType: 'quote',
    // Same Line-items tab as the quote detail view (money MQ1). The tab's own
    // header strip carries the status-driven Send/Download/Convert actions —
    // see quote-line-items-tab.tsx.
    additionalTabs: [{ value: 'line-items', label: 'Line items', icon: 'receipt-text' }],
    actions: {
      enableArchive: true,
      enableDelete: true,
    },
    // Cards mirror the detail-view sidebar (quote:customer / quote:origin are
    // registered in drawer-tab-registry.tsx's DRAWER_TAB_CARD_COMPONENTS).
    tabCards: {
      overview: [
        { value: 'customer', label: 'Customer' },
        { value: 'origin', label: 'Origin' },
      ],
    },
  },

  invoice: {
    entityType: 'invoice',
    // Drawer-only entity (01-ui #10 lock, hasDetailPage: false) — no additionalTabs, the
    // entire lifecycle/line/payment UI lives in overview tabCards (money MI1 build spec §J.1).
    additionalTabs: [],
    actions: {
      // No enableArchive — invoices are ledger records, delete is the only removal path
      // (the §G.5 override in use-entity-instance-operations.tsx routes it to
      // `money.deleteInvoice`, which enforces the payments guard + source-line unstamp).
      enableDelete: true,
    },
    tabCards: {
      overview: [
        { value: 'lines', label: 'Line items', fullBleed: true },
        { value: 'payments', label: 'Payments' },
      ],
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
