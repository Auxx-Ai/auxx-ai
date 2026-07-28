// apps/web/src/components/permissions/hooks/use-instance-grantee-rows.ts
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { INSTANCE_ACCESS_KEYS, type InstanceAccessKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useGranteeAccess } from './use-grantee-access'
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
  /**
   * What the grantee can ACTUALLY reach here, composed server-side through the
   * enforcement predicate; `null` = no access, `undefined` = not applicable
   * (a group/profile has no effective access — see {@link useGranteeAccess}).
   *
   * Distinct from {@link grantLevel} on purpose, and the gap between them is the
   * point: a user-level `none` LOSES to any group's `view`, so an admin can set
   * No access, watch the select change, and change nothing (plan 31 finding 4).
   */
  effectiveLevel: ResourcePermission | null | undefined
}

/**
 * Data + mutations for the per-instance rows nested under the Datasets /
 * Knowledge base / Dashboards / Workflows area rows in a **grantee scope** (a
 * member, team or profile's own override grid — capability layer v2 Part B).
 * Unlike the area levels above it, instance grants are NOT raise-only (§B.2.6):
 * this surface writes the grantee's raw instance-access grant through the same
 * `grantInstance`/`revokeInstance` funnel the Share card uses, offering the full
 * Inherit / Read / Write / Full / No Access vocabulary.
 *
 * **Reads one grantee, not the org** (plan 31 §2.4). It used to pull
 * `resourceAccess.allInstanceAccess` — every per-instance row for every grantee
 * — and narrow client-side. That was properly gated, so this is a SHAPE fix, not
 * an authorization one: having the org's sharing map in a member page's query
 * cache is what made the §2.1 scope leak buildable, and is what the next row
 * would have reached for.
 */
export function useInstanceGranteeRows(granteeType: GranteeKind, granteeId: string) {
  const utils = api.useUtils()
  const lists = useInstanceResourceLists(ALWAYS_OPEN)
  const {
    isLoading,
    own,
    effective,
    invalidate: refetchAccess,
  } = useGranteeAccess(granteeType, granteeId)

  const invalidate = useCallback(() => {
    void utils.permissions.granteeAccess.invalidate({ granteeType, granteeId })
    void refetchAccess()
  }, [utils, granteeType, granteeId, refetchAccess])

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
      result[key] = lists[key].items.map((item) => ({
        key,
        id: item.id,
        name: item.name,
        grantLevel: own?.instances[item.id],
        // An instance absent from `effective.instances` has no row anywhere in
        // the org, so its answer is the per-type row-less fallback. A pure
        // lookup — §2.5 is explicit that re-deriving this client-side would put
        // display and enforcement on separate implementations.
        effectiveLevel: effective
          ? (effective.instances[item.id] ?? effective.instanceFallback[key])
          : undefined,
      }))
    }
    return result
  }, [lists, own, effective])

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
    isLoading,
    rowsByKey,
    setGrant,
  }
}
