// packages/lib/src/dashboards/access.ts

import type { DashboardEntity } from '@auxx/database'

/**
 * View predicate. `'org'` dashboards are visible to every member; `'private'`
 * only to the owner. No admin carve-out in v1.
 */
export function canViewDashboard(
  dashboard: Pick<DashboardEntity, 'visibility' | 'createdById'>,
  userId: string
): boolean {
  return dashboard.visibility === 'org' || dashboard.createdById === userId
}

/**
 * Edit predicate. Same rule as {@link canViewDashboard} — shared (`'org'`)
 * dashboards are editable by all members (tighten later if needed).
 */
export function canEditDashboard(
  dashboard: Pick<DashboardEntity, 'visibility' | 'createdById'>,
  userId: string
): boolean {
  return dashboard.visibility === 'org' || dashboard.createdById === userId
}
