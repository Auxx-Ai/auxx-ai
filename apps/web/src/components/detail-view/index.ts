// apps/web/src/components/detail-view/index.ts

// Main component
export { DetailView } from './detail-view'

// Sub-components
export { DetailViewSidebar } from './detail-view-sidebar'
export { DetailViewMainTabs } from './detail-view-main-tabs'
export { DetailViewSkeleton } from './detail-view-skeleton'
export { DetailViewNotFound } from './detail-view-not-found'

// Component sub-components
export { DetailViewCardHeader } from './components/detail-view-card-header'
export { DetailViewActions } from './components/detail-view-actions'

// Tab registry
export {
  DETAIL_VIEW_TAB_COMPONENTS,
  getDetailViewTabComponent,
  hasDetailViewTabComponent,
} from './detail-view-tab-registry'

// Utilities
export { getIconComponent } from './utils'

// Types
export type {
  DetailViewProps,
  DetailViewTabProps,
  DetailViewSidebarProps,
  DetailViewMainTabsProps,
  DetailViewCardHeaderProps,
  DetailViewActionsProps,
  DetailViewSkeletonProps,
  DetailViewNotFoundProps,
  TabComponentLoader,
  DetailViewConfig,
  MainTabDefinition,
  SidebarTabDefinition,
} from './types'
