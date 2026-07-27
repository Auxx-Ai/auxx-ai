// apps/web/src/components/permissions/utils/instance-access-badge.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'

/**
 * The collapsed-row badge for one instance-access resource instance (dataset /
 * KB / dashboard — capability layer v2 Part B.2.5): `'restricted'` when the
 * workspace baseline (`role:org_member`) row is explicitly `'none'`, the
 * number of non-baseline grantee rows when the instance carries any, or
 * `undefined` when the instance is untouched (no explicit rows at all). This
 * is a fact about the INSTANCE, not the viewer, so both the Member-baseline
 * (workspace) scope and every grantee scope show the same badge for the same
 * instance.
 */
export type InstanceAccessBadge = 'restricted' | number | undefined

const BASELINE_GRANTEE_ID = 'org_member'

/** Derive {@link InstanceAccessBadge} from the rows of ONE instance (already filtered). */
export function deriveInstanceBadge(rows: ResourceAccessInfo[]): InstanceAccessBadge {
  const baselineRow = rows.find(
    (r) => r.granteeType === ResourceGranteeType.role && r.granteeId === BASELINE_GRANTEE_ID
  )
  if (baselineRow?.permission === ResourcePermission.none) return 'restricted'
  const grantCount = rows.length - (baselineRow ? 1 : 0)
  return grantCount > 0 ? grantCount : undefined
}
