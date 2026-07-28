// apps/web/src/components/permissions/hooks/use-instance-baseline-rows.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  levelToPermission,
} from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { deriveInstanceBadge, type InstanceAccessBadge } from '../utils/instance-access-badge'
import { type OpenInstanceTypes, useInstanceResourceLists } from './use-instance-resource-lists'
import { MEMBER_BASELINE_GRANTEE_ID, usePermissionGrants } from './use-permission-grants'

/**
 * Every instance-access key is always "open" here — see the hook doc below.
 *
 * **Derived, not listed**, for the reason `use-instance-grantee-rows.ts` gives:
 * the hand-written version silently omitted `agent` when it joined the registry,
 * leaving the Agents area row nesting an always-empty list.
 */
const ALWAYS_OPEN: OpenInstanceTypes = Object.fromEntries(
  INSTANCE_ACCESS_KEYS.map((key) => [key, true])
)

/** One dataset/kb/dashboard/workflow row on the Workspace defaults tab. */
export interface InstanceBaselineRow {
  key: InstanceAccessKey
  id: string
  name: string
  /** The `role:org_member` row's permission; `undefined` = Inherit (no row). */
  baselineLevel: ResourcePermission | undefined
  /** What "Inherit" resolves to — the area's base level, or No Access when the
   *  resource is born with no baseline (`baselineAtCreate: true`, dashboards). */
  inheritedLevel: ResourcePermission
  /** Collapsed-row badge derived from the org-wide `allInstanceAccess` rows. */
  badge: InstanceAccessBadge
}

/**
 * Data + mutations for the per-instance rows on the permissions page's Workspace
 * defaults tab (capability layer v2 Part B) — the instance twin of
 * `useDefBaselines`.
 *
 * Reads every listed instance via `useInstanceResourceLists` (always "open":
 * the host's search box has to match instance names to decide whether to
 * auto-expand a collection, so there is no lazy gate to defer the listing behind —
 * unlike the agent-policy grid's own per-row expand toggle) plus the org-wide
 * `resourceAccess.allInstanceAccess` rows, and derives each instance's
 * workspace-baseline level and collapsed-row badge without a per-instance
 * query (§B.2.5). Writes reuse the same `grantInstance`/`revokeInstance`
 * funnel the Share card and dialog already use, keyed to the `role:org_member`
 * grantee — "Inherit" REVOKES that row (no explicit baseline), "Restricted"
 * WRITES it at `'none'`, and Read/Write/Full write the matching permission.
 */
export function useInstanceBaselineRows() {
  const utils = api.useUtils()
  const { roleDefaults, baseline } = usePermissionGrants()
  const lists = useInstanceResourceLists(ALWAYS_OPEN)

  const allQuery = api.resourceAccess.allInstanceAccess.useQuery(undefined, { staleTime: 30_000 })
  const allRows = useMemo(() => allQuery.data ?? [], [allQuery.data])

  const invalidate = useCallback(() => {
    void utils.resourceAccess.allInstanceAccess.invalidate()
  }, [utils])

  const grantInstance = api.resourceAccess.grantInstance.useMutation({
    onError: (error) => toastError({ title: 'Error updating access', description: error.message }),
    onSettled: (_data, _error, variables) => {
      invalidate()
      if (variables)
        void utils.resourceAccess.forInstance.invalidate({ recordId: variables.recordId })
    },
  })
  const revokeInstance = api.resourceAccess.revokeInstance.useMutation({
    onError: (error) => toastError({ title: 'Error removing access', description: error.message }),
    onSettled: (_data, _error, variables) => {
      invalidate()
      if (variables)
        void utils.resourceAccess.forInstance.invalidate({ recordId: variables.recordId })
    },
  })

  const rowsByKey = useMemo(() => {
    const result = {} as Record<InstanceAccessKey, InstanceBaselineRow[]>
    for (const key of INSTANCE_ACCESS_KEYS) {
      const cfg = INSTANCE_ACCESS_RESOURCES[key]
      const areaLevel = baseline[cfg.area] ?? roleDefaults?.[cfg.area]
      const inheritedLevel = cfg.baselineAtCreate
        ? ResourcePermission.none
        : ((areaLevel !== undefined ? levelToPermission(areaLevel) : undefined) ??
          ResourcePermission.none)

      result[key] = lists[key].items.map((item) => {
        const instanceRows = allRows.filter(
          (r) => r.entityDefinitionId === key && r.entityInstanceId === item.id
        )
        const baselineRow = instanceRows.find(
          (r) =>
            r.granteeType === ResourceGranteeType.role && r.granteeId === MEMBER_BASELINE_GRANTEE_ID
        )
        return {
          key,
          id: item.id,
          name: item.name,
          baselineLevel: baselineRow?.permission,
          inheritedLevel,
          badge: deriveInstanceBadge(instanceRows),
        }
      })
    }
    return result
  }, [lists, allRows, baseline, roleDefaults])

  /** Set (or, `'inherit'`, revoke) the `role:org_member` row for one instance. */
  const setBaseline = useCallback(
    (key: InstanceAccessKey, instanceId: string, level: ResourcePermission | 'inherit') => {
      const recordId = toRecordId(key, instanceId)
      if (level === 'inherit') {
        revokeInstance.mutate({
          recordId,
          granteeType: ResourceGranteeType.role,
          granteeId: MEMBER_BASELINE_GRANTEE_ID,
        })
        return
      }
      grantInstance.mutate({
        recordId,
        granteeType: ResourceGranteeType.role,
        granteeId: MEMBER_BASELINE_GRANTEE_ID,
        permission: level,
      })
    },
    [grantInstance, revokeInstance]
  )

  return {
    lists,
    isLoading: allQuery.isLoading,
    rowsByKey,
    setBaseline,
  }
}
