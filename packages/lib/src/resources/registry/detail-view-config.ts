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
      { value: 'tickets', label: 'Tickets', icon: 'ticket', recordResource: 'ticket' },
      // Client-notifications plan §4.8/Phase 4 — same communications timeline as the job
      // detail page, over `contact:<id>`.
      { value: 'communications', label: 'Communications', icon: 'mail' },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    actions: {
      enableGroups: true,
      enableMerge: true,
      enableSpam: true,
      enableAddToSequence: true,
    },
    defaultTab: 'tickets',
    defaultSidebarTab: 'overview',
    // Renders nothing when the contact has no external identities (card
    // returns null), so it's inert until an app/store/chat links the record.
    sidebarCards: [
      { value: 'external-identities', label: 'External identities' },
      // Mail-permissions contact sharing (UI plan §4) — grants every thread
      // this contact participates in. Admin-managed; hidden for other roles
      // unless shares already exist.
      { value: 'shared-with', label: 'Shared with' },
      { value: 'billing', label: 'Billing', permissionKey: 'dispatch.board.view' },
    ],
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
    sidebarCards: [
      { value: 'metrics', label: 'Metrics', position: 'before', fullBleed: true },
      { value: 'customer', label: 'Customer' },
      { value: 'relationships', label: 'Related Tickets' },
    ],
  },

  part: {
    entityType: 'part',
    mainTabs: [
      // No `recordResource` on Inventory: it leads with the part's OWN on-hand
      // quantity/status and only then lists stock movements, so the stock_movement
      // gate belongs on its Adjust Stock action, not on the whole tab.
      { value: 'inventory', label: 'Inventory', icon: 'package' },
      { value: 'subparts', label: 'Subparts', icon: 'layers', recordResource: 'subpart' },
      { value: 'vendors', label: 'Vendors', icon: 'store', recordResource: 'vendor_part' },
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

  quote: {
    entityType: 'quote',
    // Flipped to sections (dispatch M2 build spec §G — "flips to sections via
    // config when M2 lands", money 01-ui #3/STATUS): tabs unchanged (Line items ·
    // Timeline · Tasks). QuoteLineItemsTab already renders its status-driven header
    // action strip as a normal in-flow row inside its `variant='section'` body — see
    // quote-line-items-tab.tsx — so the strip stays visible/functional since
    // DetailViewSections' <Section> wrapper is always non-collapsible.
    layout: 'sections',
    mainTabs: [
      // fullBleed: the line-items table spans edge-to-edge (cancels the Section's
      // px-3), matching the quote drawer/sidebar cards' `fullBleed` treatment.
      {
        value: 'line-items',
        label: 'Line items',
        icon: 'receipt-text',
        fullBleed: false,
        permissionKey: 'dispatch.board.view',
      },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    // Header actions are status-driven (draft/sent/approved) and live in the
    // line-items tab's own header strip — see quote-line-items-tab.tsx (money
    // MQ1 build spec §H.3: DetailViewActions only exposes generic capability
    // flags, no per-entity extension point exists yet).
    actions: {},
    defaultTab: 'line-items',
    defaultSidebarTab: 'overview',
    sidebarCards: [
      { value: 'customer', label: 'Customer' },
      { value: 'origin', label: 'Origin' },
      { value: 'jobs', label: 'Jobs', recordResource: 'work_order' },
    ],
  },

  work_order: {
    entityType: 'work_order',
    // Sections mode (dispatch M2 build spec §F.1/§F.2, 04-ui.md §6): the job view
    // is a scroll-spy page, not content-swapping tabs.
    layout: 'sections',
    mainTabs: [
      // Schedule carries the recurrence row, primary visit card, the upcoming
      // visit previews AND past visits behind an "N in history" disclosure
      // (drawer parity) — no standalone upcoming-visits or history section.
      {
        value: 'schedule',
        label: 'Schedule',
        icon: 'calendar',
        permissionKey: 'dispatch.board.view',
      },
      {
        value: 'line-items',
        label: 'Line items',
        icon: 'receipt-text',
        permissionKey: 'dispatch.board.view',
      },
      {
        value: 'billing',
        label: 'Billing',
        icon: 'credit-card',
        permissionKey: 'dispatch.board.view',
      },
      // Client-notifications plan §4.8/Phase 4 — outbound-message timeline (sequences +
      // manual quote/invoice sends).
      {
        value: 'communications',
        label: 'Communications',
        icon: 'mail',
        permissionKey: 'dispatch.board.view',
      },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    actions: {},
    defaultTab: 'schedule',
    defaultSidebarTab: 'overview',
    sidebarCards: [
      { value: 'customer-site', label: 'Customer & site' },
      { value: 'origin', label: 'Origin' },
    ],
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
