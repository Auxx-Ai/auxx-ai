// packages/lib/src/dashboards/index.ts
//
// Server entrypoint for the dashboards feature. Client-safe types/constants/
// guards live in `./client` (import those from `@auxx/lib/dashboards/client`).

export { canEditDashboard, canViewDashboard } from './access'
export { hashLayoutDoc } from './config-hash'
export {
  dashboardLayoutDocSchema,
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
export {
  getDashboard,
  getVersion,
  listDashboards,
  listVersions,
  loadDashboardRow,
  parseLayoutDoc,
} from './dashboard-queries'
export type {
  DashboardEntity,
  DashboardInsert,
  DashboardVersionEntity,
  DashboardVersionInsert,
  PublishResult,
} from './types'
export { publishLayout, renameVersion, restoreVersion } from './version-mutations'
