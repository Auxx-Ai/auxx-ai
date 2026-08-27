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
    defaultTab: 'tickets',
    defaultSidebarTab: 'overview',
    // Renders nothing when the contact has no external identities (card
    // returns null), so it's inert until an app/store/chat links the record.
    sidebarCards: [
      { value: 'external-identities', label: 'External identities' },
      // First/last interaction rows (records/interaction-fields plan Phase 5).
      // Renders nothing until the record has correspondence.
      { value: 'interactions', label: 'Interactions' },
      // Mail-permissions contact sharing (UI plan §4) — grants every thread
      // this contact participates in. Admin-managed; hidden for other roles
      // unless shares already exist.
      { value: 'shared-with', label: 'Shared with' },
      { value: 'billing', label: 'Billing', permissionKey: 'dispatch.board.view' },
    ],
  },

  company: {
    entityType: 'company',
    mainTabs: [
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    defaultTab: 'timeline',
    defaultSidebarTab: 'overview',
    // First/last interaction rows — propagated from the company's contacts.
    sidebarCards: [{ value: 'interactions', label: 'Interactions' }],
  },

  ticket: {
    entityType: 'ticket',
    mainTabs: [
      { value: 'conversation', label: 'Conversation', icon: 'mail' },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
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
      { value: 'subparts', label: 'Components', icon: 'layers', recordResource: 'subpart' },
      { value: 'vendors', label: 'Vendors', icon: 'store', recordResource: 'vendor_part' },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    defaultTab: 'inventory',
    defaultSidebarTab: 'overview',
  },

  product: {
    entityType: 'product',
    // The family page (plans/products/01-product-family.md phase 3): the
    // variants list leads — a product IS its title/image plus a set of parts.
    // The generic Details field panel lives in the sidebar overview like every
    // other detail page; no sidebarCards needed.
    mainTabs: [
      { value: 'parts', label: 'Variants', icon: 'package', recordResource: 'part' },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    defaultTab: 'parts',
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
    defaultTab: 'line-items',
    defaultSidebarTab: 'overview',
    sidebarCards: [
      { value: 'customer', label: 'Customer' },
      { value: 'origin', label: 'Origin' },
      { value: 'jobs', label: 'Jobs', recordResource: 'work_order' },
    ],
  },

  order: {
    entityType: 'order',
    // The quotes recipe (plans/products/08-order-build.md §5.7/§5.8, D17). Sections
    // rather than content-swapping tabs, so the line-items table and the timeline
    // read as one page — an order is reviewed top-to-bottom, not tabbed through.
    layout: 'sections',
    mainTabs: [
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
    defaultTab: 'line-items',
    defaultSidebarTab: 'overview',
    // No `origin` card (an order has no converted-from source) and no payments —
    // an order carries no payment ledger (§5.4). `work_order` is the D4 manual
    // link that stands in for the deferred order→work_order conversion.
    sidebarCards: [
      { value: 'customer', label: 'Customer' },
      // `work-orders`, not the quote's `jobs`: DetailViewSidebar and the drawer read
      // the SAME `DRAWER_TAB_CARD_COMPONENTS` registry, so this value is the card key
      // and must match `order:work-orders` there and in the order's drawer block.
      // "Jobs" is dispatch vocabulary; an order links work orders (08 §5.8).
      { value: 'work-orders', label: 'Work orders', recordResource: 'work_order' },
    ],
  },

  purchase_order: {
    entityType: 'purchase_order',
    // The order/quote recipe: a PO is BUILT - drafted, issued, received against -
    // so it earns a page rather than the bill's drawer
    // (plans/purchasing/01-build-plan.md §4.4).
    layout: 'sections',
    mainTabs: [
      {
        value: 'line-items',
        label: 'Lines',
        icon: 'receipt-text',
        fullBleed: false,
      },
      { value: 'timeline', label: 'Timeline', icon: 'clock' },
      { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
    ],
    sidebarTabs: DEFAULT_SIDEBAR_TABS,
    defaultTab: 'line-items',
    defaultSidebarTab: 'overview',
    // Deliberately empty for now. `vendor`, `receiving` (the computed
    // quantityReceived roll-up) and `bills` are all wanted and none is built -
    // and a card declared here with no component in
    // `DRAWER_TAB_CARD_COMPONENTS` renders NOTHING at all, silently
    // (`base-entity-drawer.tsx`: `if (!componentLoader) return null`). A
    // phantom card is worse than an absent one, so they land with their
    // components, not before.
    sidebarCards: [],
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
