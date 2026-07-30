// apps/web/src/components/permissions/hooks/use-instance-grantee-rows.ts
'use client'

import type { ResourcePermission, Rung } from '@auxx/database/enums'
import {
  INSTANCE_ACCESS_KEYS,
  type InstanceAccessKey,
  permissionToRung,
} from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import type { InstanceAccessRow } from '../ui/grantee-instance-rows'
import { INSTANCE_ROW_COPY, INSTANCE_SHARE_COPY } from '../ui/instance-share-copy'
import { displayPermissionOfRung } from '../ui/level-labels'
import { useGranteeAccess, useInvalidateGranteeAccess } from './use-grantee-access'
import type { GranteeKind } from './use-grantee-def-access'
import { type OpenInstanceTypes, useInstanceResourceLists } from './use-instance-resource-lists'

/** {@link displayPermissionOfRung}, pass-through on `undefined`. */
const optionalDisplay = (rung: Rung | undefined): ResourcePermission | undefined =>
  rung === undefined ? undefined : displayPermissionOfRung(rung)

/**
 * Every instance-access key is always "open" here — same rationale as the
 * baseline-scope hook: the host's search box has to match instance names.
 *
 * **Derived, not listed.** A hand-written map silently omitted `agent` when it
 * joined the registry in the 2026-07-28 agents slice, and because
 * `AREA_TO_INSTANCE_KEY` IS derived, the Agents area row started nesting an
 * always-empty list — a phantom control, with no failing test anywhere.
 */
const ALWAYS_OPEN: OpenInstanceTypes = Object.fromEntries(
  INSTANCE_ACCESS_KEYS.map((key) => [key, true])
)

/**
 * One dataset/kb/dashboard/workflow/agent row nested under its area in a grantee
 * scope: the shared {@link InstanceAccessRow} the renderer consumes, narrowed to
 * what this scope always supplies.
 */
export interface InstanceGranteeRow extends InstanceAccessRow {
  /**
   * What the grantee can ACTUALLY reach here, composed server-side through the
   * enforcement predicate; `null` = no access, `undefined` = not applicable
   * (a group/profile has no effective access — see {@link useGranteeAccess}).
   *
   * Distinct from `grantLevel` on purpose, and the gap between them is the
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
  const { isLoading, own, effective } = useGranteeAccess(granteeType, granteeId)
  const invalidate = useInvalidateGranteeAccess()

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
        // Scope-specific copy, so it is composed here rather than inside a row
        // component four surfaces share — the agent policy's rows say something
        // else entirely about the same instance.
        description: INSTANCE_ROW_COPY.grantee.description(INSTANCE_SHARE_COPY[key].noun),
        // Stored rung → this grid's def-axis DISPLAY vocabulary; see
        // `displayPermissionOfRung`.
        grantLevel: own ? optionalDisplay(own.instances[item.id]) : undefined,
        // An instance absent from `effective.instances` has no row anywhere in
        // the org, so its answer is the per-type row-less fallback. A pure
        // lookup — §2.5 is explicit that re-deriving this client-side would put
        // display and enforcement on separate implementations.
        effectiveLevel: effective
          ? (optionalDisplay(effective.instances[item.id] ?? undefined) ??
            optionalDisplay(effective.instanceFallback[key] ?? undefined) ??
            null)
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
      grantInstance.mutate({ recordId, granteeType, granteeId, rung: permissionToRung(level) })
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
