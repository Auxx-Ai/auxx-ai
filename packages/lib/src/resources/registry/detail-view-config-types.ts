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
}

/** Entity types that have specific detail view configurations */
export type DetailViewEntityType = 'contact' | 'ticket' | 'part' | 'entity'

/** Registry type mapping entity types to their configurations */
export type DetailViewConfigRegistry = Record<DetailViewEntityType, DetailViewConfig>
