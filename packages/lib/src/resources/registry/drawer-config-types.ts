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
}

/**
 * Drawer action capabilities
 */
export interface DrawerActions {
  enableEmailCompose?: boolean
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
  /** Position relative to default tab content */
  position?: 'before' | 'after'
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
