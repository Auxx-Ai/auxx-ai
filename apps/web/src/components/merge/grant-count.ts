// apps/web/src/components/merge/grant-count.ts

import { ResourceGranteeType, type Rung } from '@auxx/database/enums'

/**
 * Count the grantees that actually HOLD record-level access, from raw
 * `resourceAccess.forInstance` rows. Two row kinds are NOT grants and are
 * excluded:
 * - `role` rows (`role:org_member`) are the workspace baseline/floor, not a
 *   share with specific people;
 * - a `none` rung is a RESTRICTION marker — it removes access, never grants it.
 */
export function countGrantedActors(
  rows: Array<{ granteeType: ResourceGranteeType; rung: Rung }>
): number {
  return rows.filter((r) => r.granteeType !== ResourceGranteeType.role && r.rung !== 'none').length
}
