// apps/web/src/components/detail-view/types.ts

import type {
  DetailViewConfig,
  MainTabDefinition,
  SidebarTabDefinition,
} from '@auxx/lib/resources/client'
import type { ComponentType } from 'react'
import type { RecordId } from '~/components/resources'

/**
 * Props passed to detail view tab components
 */
export interface DetailViewTabProps {
  /** Entity instance ID */
  entityInstanceId: string
  /** Full recordId (entityDefinitionId:entityInstanceId) */
  recordId: RecordId
  /** Record data (from useRecord) */
  record?: Record<string, unknown>
}

/**
 * Props for the main DetailView component
 */
export interface DetailViewProps {
  /** API slug or entityDefinitionId */
  apiSlug: string
  /** Entity instance ID */
  instanceId: string
  /** Optional back URL override */
  backUrl?: string
}

/**
 * Props for DetailViewSidebar component
 */
export interface DetailViewSidebarProps {
  /** RecordId for entity fields and comments */
  recordId: RecordId
  /** Record data */
  record: Record<string, unknown>
  /** Detail view configuration */
  config: DetailViewConfig
  /** Currently active sidebar tab */
  activeTab: string
  /** Callback when sidebar tab changes */
  onTabChange: (tab: string) => void
  /** Entity icon name */
  icon?: string
  /** Entity color */
  color?: string
  /** Display name for the entity */
  displayName: string
}

/**
 * Props for DetailViewMainTabs component
 */
export interface DetailViewMainTabsProps {
  /** RecordId for tab content */
  recordId: RecordId
  /** Entity type for tab component lookup */
  entityType: string
  /** Detail view configuration */
  config: DetailViewConfig
  /** Currently active tab */
  activeTab: string
  /** Callback when tab changes */
  onTabChange: (tab: string | null) => void
  /** Record data passed to tab components */
  record?: Record<string, unknown>
}

/**
 * Props for DetailViewCardHeader component
 */
export interface DetailViewCardHeaderProps {
  /** Entity icon name */
  icon?: string
  /** Entity color */
  color?: string
  /** Display name for the entity */
  displayName: string
  /** Record data */
  record: Record<string, unknown>
}

/**
 * Props for DetailViewActions component
 */
export interface DetailViewActionsProps {
  /** Entity type for action configuration */
  entityType: string
  /** RecordId for entity operations */
  recordId: RecordId
  /** Record data */
  record: Record<string, unknown>
  /** Detail view configuration */
  config: DetailViewConfig
}

/**
 * Props for skeleton components
 */
export interface DetailViewSkeletonProps {
  /** Label for breadcrumb */
  label?: string
  /** Back URL for breadcrumb */
  backUrl: string
}

/**
 * Props for not found component
 */
export interface DetailViewNotFoundProps {
  /** Label for breadcrumb */
  label?: string
  /** Back URL for breadcrumb and return button */
  backUrl: string
}

/**
 * Tab component loader type
 */
export type TabComponentLoader = () => Promise<{ default: ComponentType<DetailViewTabProps> }>

/**
 * Re-export config types for convenience
 */
export type { DetailViewConfig, MainTabDefinition, SidebarTabDefinition }
