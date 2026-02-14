// apps/web/src/components/detail-view/index.ts

export { DetailViewActions } from './components/detail-view-actions'
// Component sub-components
export { DetailViewCardHeader } from './components/detail-view-card-header'
// Main component
export { DetailView } from './detail-view'
export { DetailViewMainTabs } from './detail-view-main-tabs'
export { DetailViewNotFound } from './detail-view-not-found'
// Sub-components
export { DetailViewSidebar } from './detail-view-sidebar'
export { DetailViewSkeleton } from './detail-view-skeleton'

// Tab registry
export {
  DETAIL_VIEW_TAB_COMPONENTS,
  getDetailViewTabComponent,
  hasDetailViewTabComponent,
} from './detail-view-tab-registry'
// Types
export type {
  DetailViewActionsProps,
  DetailViewCardHeaderProps,
  DetailViewConfig,
  DetailViewMainTabsProps,
  DetailViewNotFoundProps,
  DetailViewProps,
  DetailViewSidebarProps,
  DetailViewSkeletonProps,
  DetailViewTabProps,
  MainTabDefinition,
  SidebarTabDefinition,
  TabComponentLoader,
} from './types'
// Utilities
export { getIconComponent } from './utils'
