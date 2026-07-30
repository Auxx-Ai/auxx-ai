// apps/web/src/components/permissions/hooks/use-instance-baseline-rows.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import {
  type Area,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  Level,
  levelToRung,
  permissionToRung,
} from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { displayPermissionOfRung } from '../ui/level-labels'
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

/**
 * Resources where the fall-through option is renamed **`Private`** (plan 43
 * §5.3).
 *
 * `inheritedLevel` is a CONSTANT `none` for every `baselineAtCreate: true`
 * resource, so on these three "Inherit" and "Restricted" were the same state
 * wearing two labels. The census settles which three: `signature`, `snippet` and
 * `personal_inbox` have **zero** `role:org_member` rows in existence, so Inherit
 * is unreachable as anything else.
 *
 * `dashboard` is deliberately NOT here despite sharing `baselineAtCreate: true` —
 * it has 89 real baseline rows, so its Inherit resolves to something. And
 * `snippet` IS here despite having 28: those are instances that *have* a
 * baseline, and they display their own permission rather than "Inherit". The
 * rename only reaches rows with **no** baseline row, where the label is a
 * constant either way.
 */
export const PRIVATE_INHERIT_KEYS: ReadonlySet<InstanceAccessKey> = new Set<InstanceAccessKey>([
  'signature',
  'snippet',
  'personal_inbox',
])

export const PRIVATE_INHERIT_LABEL = 'Private'
export const PRIVATE_INHERIT_HELPER = 'Only people granted below'

/** One dataset/kb/dashboard/workflow row on the Workspace defaults tab. */
export interface InstanceBaselineRow {
  key: InstanceAccessKey
  id: string
  name: string
  /** The `role:org_member` row's permission; `undefined` = Inherit (no row). */
  baselineLevel: ResourcePermission | undefined
  /**
   * What the fall-through option resolves to, rendered inline on it
   * (`Inherit · Read only`). **`undefined` on the {@link PRIVATE_INHERIT_KEYS}**,
   * which drops the suffix — `Private · No access` states the same fact twice.
   */
  inheritedLevel: ResourcePermission | undefined
  /** Name for the fall-through option — `Private` where nothing is inherited. */
  inheritLabelText?: string
  /** Helper line under that option. */
  inheritHelperText?: string
  /** Collapsed-row badge derived from the org-wide `allInstanceAccess` rows. */
  badge: InstanceAccessBadge
}

/**
 * The Member profile's area level for one instance-access resource type — what
 * the tab's **read-only** access row (plan 43 §5.2) displays above each
 * collection.
 *
 * `value` is the Member profile's own stored rung and `inherited` the USER-rank
 * floor it falls through to: exactly the pair the profile editor's access row is
 * fed, so the same profile reads the same on both screens (§8 item 19).
 */
export interface InstanceAreaAccess {
  area: Area
  value: Level | undefined
  inherited: Level
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

  /**
   * The Member profile's area rung per resource type — the subject of the tab's
   * read-only access row. Kept beside `rowsByKey` rather than derived in the host
   * so both read the same `baseline` / `roleDefaults` pair.
   */
  const areaAccessByKey = useMemo(() => {
    const result = {} as Record<InstanceAccessKey, InstanceAreaAccess>
    for (const key of INSTANCE_ACCESS_KEYS) {
      const { area } = INSTANCE_ACCESS_RESOURCES[key]
      result[key] = {
        area,
        value: baseline[area],
        inherited: roleDefaults?.[area] ?? Level.None,
      }
    }
    return result
  }, [baseline, roleDefaults])

  const rowsByKey = useMemo(() => {
    const result = {} as Record<InstanceAccessKey, InstanceBaselineRow[]>
    for (const key of INSTANCE_ACCESS_KEYS) {
      const cfg = INSTANCE_ACCESS_RESOURCES[key]
      const areaLevel = baseline[cfg.area] ?? roleDefaults?.[cfg.area]
      const isPrivate = PRIVATE_INHERIT_KEYS.has(key)
      // Plan 43 §5.3 — `undefined` is what suppresses the `· <resolved>` suffix,
      // so the private three read a bare `Private` rather than a resolution that
      // is `No access` by construction and says nothing.
      const inheritedLevel = isPrivate
        ? undefined
        : cfg.baselineAtCreate
          ? ResourcePermission.none
          : ((areaLevel !== undefined
              ? displayPermissionOfRung(levelToRung(areaLevel) ?? 'none')
              : undefined) ?? ResourcePermission.none)

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
          // Stored rung → the grid's def-axis display vocabulary (see
          // `displayPermissionOfRung` for why this is a clamp, not a conversion).
          baselineLevel: baselineRow ? displayPermissionOfRung(baselineRow.rung) : undefined,
          inheritedLevel,
          inheritLabelText: isPrivate ? PRIVATE_INHERIT_LABEL : undefined,
          inheritHelperText: isPrivate ? PRIVATE_INHERIT_HELPER : undefined,
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
        rung: permissionToRung(level),
      })
    },
    [grantInstance, revokeInstance]
  )

  return {
    lists,
    isLoading: allQuery.isLoading,
    rowsByKey,
    areaAccessByKey,
    setBaseline,
  }
}
