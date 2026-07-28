// apps/web/src/components/permissions/hooks/use-instance-grantee-rows.ts
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { INSTANCE_ACCESS_KEYS, type InstanceAccessKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { deriveInstanceBadge, type InstanceAccessBadge } from '../utils/instance-access-badge'
import type { GranteeKind } from './use-grantee-def-access'
import { type OpenInstanceTypes, useInstanceResourceLists } from './use-instance-resource-lists'

/** Every instance-access key is always "open" here — same rationale as the
 *  baseline-scope hook: the host's search box has to match instance names. */
const ALWAYS_OPEN: OpenInstanceTypes = {
  dataset: true,
  kb: true,
  dashboard: true,
  workflow: true,
}

/** One dataset/kb/dashboard row nested under its area in a grantee scope. */
export interface InstanceGranteeRow {
  key: InstanceAccessKey
  id: string
  name: string
  /** This grantee's own explicit grant; `undefined` = Inherit (no row). */
  grantLevel: ResourcePermission | undefined
  /** Collapsed-row badge derived from the org-wide `allInstanceAccess` rows —
   *  the same fact regardless of which grantee's page this is (§B.2.5). */
  badge: InstanceAccessBadge
}

/**
 * Data + mutations for the per-instance rows nested under the Datasets /
 * Knowledge base / Dashboards area rows in a **grantee scope** (a member or
 * team's own override grid — capability layer v2 Part B). Unlike the area
 * levels above it, instance grants are NOT raise-only (§B.2.6): this surface
 * writes the grantee's raw instance-access grant through the same
 * `grantInstance`/`revokeInstance` funnel the Share card uses, offering the
 * full Inherit / Read / Write / Full / No Access vocabulary.
 *
 * Reads the same org-wide `resourceAccess.allInstanceAccess` rows as the
 * baseline-scope hook (one query, shared React Query cache across every
 * mounted area) and narrows to this grantee's own row per instance.
 */
export function useInstanceGranteeRows(granteeType: GranteeKind, granteeId: string) {
  const utils = api.useUtils()
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
    const result = {} as Record<InstanceAccessKey, InstanceGranteeRow[]>
    for (const key of INSTANCE_ACCESS_KEYS) {
      result[key] = lists[key].items.map((item) => {
        const instanceRows = allRows.filter(
          (r) => r.entityDefinitionId === key && r.entityInstanceId === item.id
        )
        const ownRow = instanceRows.find(
          (r) => r.granteeType === granteeType && r.granteeId === granteeId
        )
        return {
          key,
          id: item.id,
          name: item.name,
          grantLevel: ownRow?.permission,
          badge: deriveInstanceBadge(instanceRows),
        }
      })
    }
    return result
  }, [lists, allRows, granteeType, granteeId])

  /** Set (or, `'inherit'`, revoke) this grantee's own row for one instance. */
  const setGrant = useCallback(
    (key: InstanceAccessKey, instanceId: string, level: ResourcePermission | 'inherit') => {
      const recordId = toRecordId(key, instanceId)
      if (level === 'inherit') {
        revokeInstance.mutate({ recordId, granteeType, granteeId })
        return
      }
      grantInstance.mutate({ recordId, granteeType, granteeId, permission: level })
    },
    [grantInstance, revokeInstance, granteeType, granteeId]
  )

  return {
    lists,
    isLoading: allQuery.isLoading,
    rowsByKey,
    setGrant,
  }
}
