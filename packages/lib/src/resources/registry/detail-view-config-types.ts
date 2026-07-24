// packages/lib/src/resources/registry/detail-view-config-types.ts

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
   * Cancel the wrapping `<Section>`'s horizontal inset so the content (e.g. a
   * line-items table) spans edge-to-edge — the `sections` layout twin of the
   * drawer card's `fullBleed` (drawer-config-types.ts). Applies `-mx-3` to the
   * section body via `ChromedSection`.
   */
  fullBleed?: boolean
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
 * Header action capabilities for detail views
 */
export interface DetailViewActions {
  enableGroups?: boolean
  enableMerge?: boolean
  enableSpam?: boolean
  enableArchive?: boolean
  enableDelete?: boolean
  enableWorkflowTrigger?: boolean
  /** Sequences plan §17 — "Add to sequence" opens `AddToSequenceDialog` for this record. */
  enableAddToSequence?: boolean
}

/**
 * Complete detail view configuration for an entity type
 * NOTE: Does NOT include entity metadata (label, icon, color, etc.)
 * That comes from the Resource via useResourceProperty hook.
 * This ONLY contains detail-view-specific config (tabs, actions).
 */
export interface DetailViewConfig {
  /** Entity type identifier (ModelType: 'contact', 'ticket', 'part', 'entity') */
  entityType: string
  /** Tabs shown in main content area */
  mainTabs: MainTabDefinition[]
  /** Tabs shown in sidebar (Overview, Comments) */
  sidebarTabs: SidebarTabDefinition[]
  /** Header actions */
  actions: DetailViewActions
  /** Default main tab to select */
  defaultTab?: string
  /** Default sidebar tab to select */
  defaultSidebarTab?: string
  /** Cards rendered in the sidebar (reuses DrawerTabCardDefinition for shared card component registry) */
  sidebarCards?: DrawerTabCardDefinition[]
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
export type DetailViewEntityType = 'contact' | 'ticket' | 'part' | 'entity' | 'quote' | 'work_order'

/** Registry type mapping entity types to their configurations */
export type DetailViewConfigRegistry = Record<DetailViewEntityType, DetailViewConfig>
