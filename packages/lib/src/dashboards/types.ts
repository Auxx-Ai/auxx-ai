// packages/lib/src/dashboards/types.ts
//
// Server-side type surface: re-exports the client-safe types and adds the
// db-shaped result types the queries/mutations return.

export type {
  DashboardEntity,
  DashboardInsert,
  DashboardVersionEntity,
  DashboardVersionInsert,
} from '@auxx/database'

export type {
  DashboardGlobalFilters,
  DashboardLayoutDoc,
  DashboardSummary,
  DashboardVersionSummary,
  DashboardVisibility,
  DashboardWithLayout,
  GridPosition,
  LayoutTab,
  LayoutWidget,
  WidgetConfiguration,
  WidgetKind,
  WidgetSource,
} from './client'

/** Publish result — the active version's doc plus whether the save was a no-op. */
export type PublishResult = {
  dashboard: import('./client').DashboardWithLayout
  unchanged: boolean
}
