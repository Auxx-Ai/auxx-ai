// packages/lib/src/resources/registry/drawer-config.ts

import type { DrawerConfig, DrawerConfigRegistry } from './drawer-config-types'

/**
 * Drawer configuration registry
 * ONLY contains drawer-specific config (tabs, cards) — record actions live in
 * `record-actions-config.ts`
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
      { value: 'tickets', label: 'Tickets', icon: 'ticket', recordResource: 'ticket' },
      { value: 'conversations', label: 'Conversations', icon: 'mail' },
    ],
    tabCards: {
      overview: [
        // First/last interaction rows (records/interaction-fields plan Phase 5).
        { value: 'interactions', label: 'Interactions', position: 'after' },
        {
          value: 'billing',
          label: 'Billing',
          position: 'after',
          permissionKey: 'dispatch.board.view',
        },
      ],
    },
  },

  company: {
    entityType: 'company',
    additionalTabs: [
      { value: 'parts', label: 'Parts', icon: 'package', recordResource: 'vendor_part' },
    ],
    tabCards: {
      overview: [{ value: 'interactions', label: 'Interactions', position: 'after' }],
    },
  },

  ticket: {
    entityType: 'ticket',
    additionalTabs: [{ value: 'conversation', label: 'Conversation', icon: 'mail' }],
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
      { value: 'subparts', label: 'Components', icon: 'layers', recordResource: 'subpart' },
      { value: 'vendors', label: 'Suppliers', icon: 'truck', recordResource: 'vendor_part' },
    ],
    tabCards: {
      overview: [
        { value: 'inventory', label: 'Inventory' },
        // Cost provenance: buy-vs-build comparison + the not-costed signal.
        // The card renders nothing for a part with a single cost candidate
        // (the common case), which hides the whole section.
        { value: 'costing', label: 'Costing' },
        // Sellable toggle / pricing row — "sellable" is derived from the
        // backing catalog_item, never stored (plans/products/01-product-family.md
        // §6.1). Renders nothing for a part with no catalog item — unless it's
        // a finished good, whose missing price surfaces prominently.
        { value: 'pricing', label: 'Pricing' },
        // Product-family membership + the finished-good suggestion
        // (plans/products/01-product-family.md phase 3). Renders nothing for a
        // part with no `product` relation (most parts — raw materials), which
        // hides the whole section.
        { value: 'family', label: 'Family' },
      ],
    },
  },

  product: {
    entityType: 'product',
    // The family's parts (its variants) as rows — the same `part:product`
    // edge the detail page's Variants tab lists.
    additionalTabs: [
      { value: 'parts', label: 'Variants', icon: 'package', recordResource: 'part' },
    ],
    // Overview blocks (plans/products/09-variant-ui.md §7). Both render nothing
    // when they have nothing — an empty family, or no linked vendor — which
    // hides their whole section.
    tabCards: {
      overview: [
        // Variant count, stock, price range and how many variants carry a sell
        // price. Reads `part`, so it is gated on that definition.
        { value: 'summary', label: 'Family', icon: 'package', recordResource: 'part' },
        // `product.vendor` → `company` click-through (D9 — a supplier is
        // already a company, never a free-text brand string). No
        // `recordResource`: this is the product's OWN relationship value, not a
        // list of another definition's records, and the server already redacts
        // an unreadable target — the same call `ticket:customer` makes.
        { value: 'vendor', label: 'Vendor', icon: 'store' },
      ],
    },
  },

  service_request: {
    entityType: 'service_request',
    additionalTabs: [],
    // Related work orders + quotes rendered as uniform overview blocks (styled like
    // the ticket customer block). The `workOrders`/`quotes` inverse fields are hidden
    // from the Details field panel (showInPanel:false) so they only appear here.
    tabCards: {
      overview: [
        {
          value: 'work-orders',
          label: 'Work orders',
          icon: 'wrench',
          recordResource: 'work_order',
        },
        { value: 'quotes', label: 'Quotes', icon: 'file-text', recordResource: 'quote' },
      ],
    },
  },

  work_order: {
    entityType: 'work_order',
    additionalTabs: [],
    // Schedule (visits + schedule popover) and Invoices (list + gather dialog) as
    // uniform overview blocks — the quote/line-items relationship fields are hidden
    // from the Details panel (showInPanel:false) so they only surface here.
    tabCards: {
      overview: [
        {
          value: 'schedule',
          label: 'Schedule',
          icon: 'calendar-clock',
          permissionKey: 'dispatch.board.view',
        },
        {
          value: 'billing',
          label: 'Billing',
          icon: 'credit-card',
          permissionKey: 'dispatch.board.view',
        },
        // Client-notifications plan §4.8/Phase 4 — compact recent-communications card.
        {
          value: 'communications',
          label: 'Communications',
          icon: 'mail',
          permissionKey: 'dispatch.board.view',
        },
      ],
    },
  },

  quote: {
    entityType: 'quote',
    // No additionalTabs — the drawer shows line items as an Overview card
    // (the invoice pattern below); the FULL detail page keeps its sections
    // layout via the separate DETAIL_VIEW_CONFIG_REGISTRY. Drawer overview
    // cards and detail-page sidebarCards are independent lists, so this
    // never leaks onto the detail page.
    additionalTabs: [],
    tabCards: {
      overview: [
        {
          value: 'lines',
          label: 'Line items',
          fullBleed: true,
          permissionKey: 'dispatch.board.view',
        },
        { value: 'customer', label: 'Customer' },
        { value: 'origin', label: 'Origin' },
        { value: 'jobs', label: 'Jobs', recordResource: 'work_order' },
        // Deposit visibility (deposit-accounting plan 16 §D.5) — the card itself renders
        // null when the quote has no deposit charge, so this stays in the list unconditionally.
        { value: 'deposit', label: 'Deposit', permissionKey: 'dispatch.board.view' },
      ],
    },
  },

  invoice: {
    entityType: 'invoice',
    // Drawer-only entity (01-ui #10 lock, hasDetailPage: false) — no additionalTabs, the
    // entire lifecycle/line/payment UI lives in overview tabCards (money MI1 build spec §J.1).
    additionalTabs: [],
    tabCards: {
      overview: [
        {
          value: 'lines',
          label: 'Line items',
          fullBleed: false,
          icon: 'file-text',
          permissionKey: 'dispatch.board.view',
        },
        {
          value: 'billing-context',
          label: 'Billing context',
          icon: 'calendar-clock',
        },
        {
          value: 'payments',
          label: 'Payments',
          icon: 'credit-card',
          permissionKey: 'dispatch.board.view',
        },
      ],
    },
  },

  // The third totalled money document (plans/products/08-order-build.md §5.8).
  // Unlike invoice this is NOT a drawer-only entity — `order` has
  // `hasDetailPage: true` (§5.7, D17), so these Overview cards and the detail
  // page's own sections are independent lists rendering the same components.
  //
  // Two cards, not §5.8's three: there is no separate `totals` card because the
  // LineBuilder's own `TotalsFooter` already renders subtotal/discount/tax/total
  // at the foot of the lines card — exactly as it does for quote and invoice,
  // neither of which carries a totals card either. A third card would be a
  // second, competing rendering of the same three mirrored fields.
  order: {
    entityType: 'order',
    additionalTabs: [],
    tabCards: {
      overview: [
        {
          value: 'lines',
          label: 'Line items',
          fullBleed: true,
          permissionKey: 'dispatch.board.view',
        },
        { value: 'customer', label: 'Customer' },
        { value: 'work-orders', label: 'Work orders', recordResource: 'work_order' },
      ],
    },
  },

  purchase_order: {
    entityType: 'purchase_order',
    additionalTabs: [],
    tabCards: {
      // `vendor` and `totals` are wanted and unbuilt - see the note on
      // `purchase_order.sidebarCards` in detail-view-config.ts for why an
      // unbacked card key is not declared here in advance.
      overview: [{ value: 'lines', label: 'Lines', fullBleed: true }],
    },
  },

  vendor_bill: {
    entityType: 'vendor_bill',
    // Drawer-only, no detail page: a bill RECORDS something already settled, so
    // there is nothing to iterate on (plans/purchasing/01-build-plan.md §5.1).
    // The exception queue is a filtered list view, not a page per bill.
    additionalTabs: [],
    tabCards: {
      // `vendor` and `payment` are wanted and unbuilt, as above.
      overview: [
        { value: 'lines', label: 'Lines', fullBleed: true },
        { value: 'match', label: 'Match' },
      ],
    },
  },
}

/**
 * Get drawer configuration for entity type
 * Returns ONLY drawer-specific config (tabs, cards)
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
  }
}

export function hasDrawerConfig(entityType: string): boolean {
  return entityType in DRAWER_CONFIG_REGISTRY
}
