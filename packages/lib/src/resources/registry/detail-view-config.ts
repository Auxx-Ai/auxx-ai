// packages/lib/src/resources/registry/detail-view-config.ts

import type {
  DetailViewConfig,
  DetailViewConfigRegistry,
  DetailViewEntityType,
  SidebarTabDefinition,
} from './detail-view-config-types'

/** Default sidebar tabs for all entity types */
const DEFAULT_SIDEBAR_TABS: SidebarTabDefinition[] = [
  { value: 'overview', label: 'Overview', icon: 'house' },
  { value: 'comments', label: 'Comments', icon: 'messages' },
]

/**
 * Detail view configuration registry
 * Contains config for main tabs, sidebar tabs, and actions per entity type
 *
 * Universal tabs available for all entity types:
 * - timeline: Activity timeline
 * - tasks: Related tasks
 *
 * Entity-specific tabs are added per config (e.g., tickets/orders for contact)
 */
export const DETAIL_VIEW_CONFIG_REGISTRY: DetailViewConfigRegistry = {
  contact: {
    entityType: 'contact',
    mainTabs: [
      { value: 'tickets', label: 'Tickets', icon: 'ticket' },
      { value: 'orders', label: 'Orders', icon: 'shopping-bag' },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    actions: {
      enableGroups: true,
      enableMerge: true,
      enableSpam: true,
    },
    defaultTab: 'tickets',
    defaultSidebarTab: 'overview',
  },

  ticket: {
    entityType: 'ticket',
    mainTabs: [
      { value: 'conversation', label: 'Conversation', icon: 'mail' },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    actions: {
      enableArchive: true,
      enableMerge: true,
    },
    defaultTab: 'conversation',
    defaultSidebarTab: 'overview',
  },

  part: {
    entityType: 'part',
    mainTabs: [
      { value: 'inventory', label: 'Inventory', icon: 'package' },
      { value: 'subparts', label: 'Subparts', icon: 'layers' },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    actions: {
      enableArchive: true,
      enableDelete: true,
    },
    defaultTab: 'inventory',
    defaultSidebarTab: 'overview',
  },

  /** Generic entities (custom entityDefinitions with entityType='entity') */
  entity: {
    entityType: 'entity',
    mainTabs: [
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    actions: {
      enableArchive: true,
      enableDelete: true,
      enableWorkflowTrigger: true,
    },
    defaultTab: 'timeline',
    defaultSidebarTab: 'overview',
  },
}

/**
 * Get detail view config for entity type
 * @param entityType - ModelType from resource.entityType
 * @returns DetailViewConfig for the entity type, or generic 'entity' config as fallback
 */
export function getDetailViewConfig(entityType: string): DetailViewConfig {
  // Check if we have a specific config for this entity type
  if (entityType in DETAIL_VIEW_CONFIG_REGISTRY) {
    return DETAIL_VIEW_CONFIG_REGISTRY[entityType as DetailViewEntityType]
  }

  // Fallback to generic entity config
  return DETAIL_VIEW_CONFIG_REGISTRY.entity
}

/**
 * Check if entity type has a specific detail view config
 */
export function hasDetailViewConfig(entityType: string): boolean {
  return entityType in DETAIL_VIEW_CONFIG_REGISTRY
}
