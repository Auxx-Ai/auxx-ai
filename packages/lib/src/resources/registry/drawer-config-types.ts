// packages/lib/src/resources/registry/drawer-config-types.ts

/**
 * Drawer tab metadata (no React components)
 * Just the data needed to describe a tab
 */
export interface DrawerTabDefinition {
  /** Unique tab identifier (e.g., 'tickets', 'orders') */
  value: string
  /** Display label */
  label: string
  /** Icon name (e.g., 'ticket', 'shopping-bag') - not the React component */
  icon: string
  /** Optional feature gate key — tab is hidden when the org lacks access */
  featureGate?: string
  /**
   * Resource slug of the record type this tab LISTS (e.g. `ticket` for the
   * contact drawer's Tickets tab) — not the drawer's own entity type. The tab is
   * hidden when the viewer can't read that definition (Layer 3 `canViewEntity`),
   * the same enumeration rule `useViewableResources` applies to the sidebar and
   * pickers. Omit for tabs that don't list another definition's records (mail
   * conversations, which are governed by the thread visibility lens instead).
   */
  recordResource?: string
}

/**
 * Drawer action capabilities
 */
export interface DrawerActions {
  enableMerge?: boolean
  enableGroups?: boolean
  enableAssign?: boolean
  enableArchive?: boolean
  enableDelete?: boolean
  enableLink?: boolean
  enableRename?: boolean
  enableEdit?: boolean
}

/**
 * Card definition injected into base drawer tabs (overview, timeline, comments, tasks)
 */
export interface DrawerTabCardDefinition {
  /** Unique identifier (e.g., 'customer', 'relationships', 'metrics') */
  value: string
  /** Display label shown as section header */
  label: string
  /** Optional icon name shown next to the section header (resolved in the frontend). */
  icon?: string
  /** Position relative to default tab content */
  position?: 'before' | 'after'
  /**
   * Optional Layer-2 capability gate (a {@link PermissionKey} value, e.g.
   * `dispatch.board.view`) — the whole card section (header included) is hidden
   * when the viewer lacks the key, mirroring the router's procedure gate so no
   * empty section renders before the query 403s.
   */
  permissionKey?: string
  /**
   * Resource slug of the record type this card LISTS — the per-definition twin
   * of `permissionKey`, applied the same way (whole section hidden). Set it only
   * for cards that are purely another definition's records; cards showing the
   * base record's own relationship values (`customer`, `origin`) are left alone,
   * since the server already redacts an unreadable target.
   */
  recordResource?: string
  /**
   * Render the card edge-to-edge by cancelling the wrapping Section's horizontal
   * padding (and bottom gap). Use for full-bleed strips like the metrics grid.
   */
  fullBleed?: boolean
}

/**
 * Complete drawer configuration for an entity type
 * NOTE: Does NOT include entity metadata (label, icon, color, etc.)
 * That comes from the Resource via useResource hook.
 * This ONLY contains drawer-specific config (tabs, actions).
 */
export interface DrawerConfig {
  /** Entity type identifier (for system entities: 'contact', 'ticket', etc.) */
  entityType: string
  /** Additional tabs beyond Overview, Timeline, Comments */
  additionalTabs: DrawerTabDefinition[]
  /** Action capabilities */
  actions: DrawerActions
  /** Cards injected into base tabs (overview, timeline, comments, tasks). Key is tab value. */
  tabCards?: Record<string, DrawerTabCardDefinition[]>
}

export type DrawerConfigRegistry = Record<string, DrawerConfig>
