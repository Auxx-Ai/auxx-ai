// packages/lib/src/dashboards/index.ts
//
// Server entrypoint for the dashboards feature. Client-safe types/constants/
// guards live in `./client` (import those from `@auxx/lib/dashboards/client`).

export { hashLayoutDoc } from './config-hash'
export {
  chartQueryInputSchema,
  dashboardLayoutDocSchema,
  draftLayoutDocSchema,
  globalFiltersSchema,
  widgetConfigurationSchema,
  widgetFieldRefSchema,
} from './config-schemas'
export {
  archiveDashboard,
  type CreateDashboardInput,
  createDashboard,
  duplicateDashboard,
  type UpdateDashboardPatch,
  updateDashboard,
} from './dashboard-mutations'
export type { DashboardSelector } from './dashboard-queries'
export {
  getDashboard,
  getVersion,
  listDashboards,
  listVersions,
  loadDashboardRow,
  parseDraftLayoutDoc,
  parseLayoutDoc,
} from './dashboard-queries'
export type {
  DashboardEntity,
  DashboardInsert,
  DashboardVersionEntity,
  DashboardVersionInsert,
  PublishResult,
} from './types'
export {
  deleteVersion,
  discardDashboardDraft,
  publishDashboard,
  renameVersion,
  restoreVersion,
  saveDraft,
} from './version-mutations'
