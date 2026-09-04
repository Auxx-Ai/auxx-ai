// packages/lib/src/resources/registry/detail-view-config-types.ts

import type { LayoutBlock } from './block-types'
import type { DrawerTabCardDefinition } from './drawer-config-types'

/**
 * Tab definition for main content area
 * Describes tabs shown in the primary content area of the detail view
 */
export interface MainTabDefinition {
  /** Unique tab identifier (e.g., 'tickets', 'timeline') */
  value: string
  /** Display label */
  label: string
  /** Icon name (e.g., 'ticket', 'clock') */
  icon: string
  /** Capability required to render the tab and mount its query-owning content. */
  permissionKey?: string
  /**
   * Resource slug of the record type this tab LISTS (e.g. `ticket` for the
   * contact page's Tickets tab) — the per-definition twin of `permissionKey`,
   * which is too coarse here (`records.view` is true for anyone holding any
   * record access). The tab is hidden when the viewer can't read that
   * definition. See {@link DrawerTabDefinition.recordResource}; omit for tabs
   * that also show the base record's OWN data (part Inventory mixes stock
   * movements with the part's on-hand fields).
   */
  recordResource?: string
  /**
   * Cancel the wrapping `<Section>`'s horizontal inset so the content (e.g. a
   * line-items table) spans edge-to-edge — the `sections` layout twin of the
   * drawer card's `fullBleed` (drawer-config-types.ts). Applies `-mx-3` to the
   * section body via `ChromedSection`.
   */
  fullBleed?: boolean
  /**
   * Whether this tab mounts a lazily loaded component of its own from
   * `DETAIL_VIEW_TAB_COMPONENTS`. Defaults to `true`, which is every tab that
   * predates the record layout system.
   *
   * Set to `false` for a tab that IS its blocks, so the detail view renders the
   * blocks alone instead of a "Tab component not found" placeholder. The
   * drawer's twin is {@link DrawerTabDefinition.hasOwnComponent}, and the two
   * surfaces must agree or a tab shipped on one shows an error on the other.
   */
  hasOwnComponent?: boolean
}

/**
 * Sidebar tab definition
 * Describes tabs shown in the sidebar panel
 */
export interface SidebarTabDefinition {
  /** Unique tab identifier (e.g., 'overview', 'comments') */
  value: string
  /** Display label */
  label: string
  /** Icon name (e.g., 'house', 'messages') */
  icon: string
}

/**
 * Complete detail view configuration for an entity type
 * NOTE: Does NOT include entity metadata (label, icon, color, etc.)
 * That comes from the Resource via useResourceProperty hook.
 * This ONLY contains detail-view-specific config (tabs, layout). Record ACTIONS
 * are not here — they are one shared registry, `record-actions-config.ts`.
 */
export interface DetailViewConfig {
  /** Entity type identifier (ModelType: 'contact', 'ticket', 'part', 'entity') */
  entityType: string
  /** Tabs shown in main content area */
  mainTabs: MainTabDefinition[]
  /** Tabs shown in sidebar (Overview, Comments) */
  sidebarTabs: SidebarTabDefinition[]
  /** Default main tab to select */
  defaultTab?: string
  /** Default sidebar tab to select */
  defaultSidebarTab?: string
  /** Cards rendered in the sidebar (reuses DrawerTabCardDefinition for shared card component registry) */
  sidebarCards?: DrawerTabCardDefinition[]
  /**
   * Blocks placed on a MAIN tab, keyed by tab value: the detail-view twin of
   * {@link DrawerConfig.tabBlocks} (`plans/drawer/record-layout-system.md` §10:
   * a shared block lands on both surfaces at once, or the two registries drift).
   *
   * The sidebar is deliberately NOT covered: it is a separate region and is out
   * of scope for the layout system (§9.7), so `sidebarCards` stays as it is.
   */
  tabBlocks?: Record<string, LayoutBlock[]>
  /**
   * Main-area layout mode (dispatch M2 build spec §F.1):
   * - `'tabs'` (default): content-swapping `TabsContent` panels — unchanged ticket/contact/
   *   part/quote behavior, rendered by `DetailViewMainTabs`.
   * - `'sections'`: a single scroll-spy page (agent-detail pattern) — the mainTabs render as
   *   stacked `<Section>` anchors on ONE scrolling column instead of swapped panels, rendered
   *   by `DetailViewSections`.
   */
  layout?: 'tabs' | 'sections'
}

/** Entity types that have specific detail view configurations */
export type DetailViewEntityType =
  | 'contact'
  | 'company'
  | 'ticket'
  | 'part'
  | 'product'
  | 'entity'
  | 'quote'
  | 'work_order'
  | 'order'
  | 'purchase_order'
  | 'build'

/** Registry type mapping entity types to their configurations */
export type DetailViewConfigRegistry = Record<DetailViewEntityType, DetailViewConfig>
