// apps/web/src/components/permissions/hooks/use-instance-share.ts
'use client'

import { ResourceGranteeType, type Rung } from '@auxx/database/enums'
import type { Level } from '@auxx/lib/permissions/client'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'
import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo } from 'react'
import {
  actorIdToGrantee,
  GRANTEE_UNSUPPORTED_MESSAGE,
  granteeToActorId,
  isActorGrantee,
  type UnmanageableGrant,
} from '~/components/permissions/utils/grantee'
import { api } from '~/trpc/react'

/**
 * Instance grant level — the raw Read/Write/Full rung on a `ResourceAccess` row.
 *
 * `Exclude<Rung, …>` rather than a hand-written union so this picker can never
 * offer a rung the config-scale resources do not declare: `metadata` and
 * `identity` are mail's tiers (`INBOX_RUNGS`), and `none` is a RESTRICTION,
 * expressed by `WorkspaceBaseline`'s `'restricted'` and never by a grantee row.
 */
export type InstanceLevel = Exclude<Rung, 'none' | 'metadata' | 'identity'>

/**
 * The workspace-baseline (`role:org_member`) state for an instance:
 *  - `view`/`edit`/`admin` — everyone in the workspace gets at least this level;
 *  - `'restricted'` — an explicit `'none'` marker (no org-wide access);
 *  - `undefined` — no explicit baseline row: the instance falls back to its L2
 *    area base level (for `baselineAtCreate: false` resources that's org-Read,
 *    i.e. shared-with-org by default — until a first grant materializes it).
 */
export type WorkspaceBaseline = InstanceLevel | 'restricted' | undefined

export interface InstanceShareGrant {
  actorId: ActorId
  choice: InstanceLevel
  /**
   * The raw stored rung, INCLUDING `'none'` — which {@link choice} cannot
   * express. Only the dead-row warning reads it (see {@link granteeAreaLevel}).
   */
  rung: Rung
  /**
   * The user grantee's own composed Layer-2 level for this instance's L2 area
   * (capability layer v2 Part B.2.8), server-annotated on `forInstance`.
   * `undefined` for group/team/role/profile grantees — they are level
   * *sources*, not subjects — and while the annotation hasn't loaded yet.
   *
   * `Level.None` no longer means the row is dead: since plan 25 §2 an explicit
   * row beats the area floor, so a positive grant on a `None`-area member is
   * precisely how a single-instance share works. Only `Level.None` combined with
   * an explicit `'none'` {@link rung} is inert — it removes access the member
   * never had.
   */
  granteeAreaLevel?: Level
}

/** The fixed grantee for the workspace baseline (everyone in the org). */
const WORKSPACE_GRANTEE = {
  granteeType: ResourceGranteeType.role,
  granteeId: 'org_member',
} as const

/**
 * Sharing state + mutations for one instance-access resource instance (datasets
 * etc.), keyed by its whole `RecordId`. The drop-in sibling of `useMailShare`,
 * minus the mail-lens semantics — it writes the RAW instance grant
 * (Read/Write/Full) over `resourceAccess.forInstance` (read) +
 * `grantInstance`/`revokeInstance` (write).
 *
 * **No workspace-baseline preservation any more, and none is needed** (2026-07-29).
 * `grant` used to write a `role:org_member @ view` row alongside the first
 * explicit grant, because `effectiveInstanceLevel` read "carries ≥1 row" as
 * "restricted" and a single share therefore privatized the whole instance. That
 * conflation is fixed in the resolver (`governingInstanceIds`): a
 * `baselineAtCreate: false` instance stays at its area level for everyone who has
 * no row, until somebody authors a real restriction. See {@link grant}.
 */
export function useInstanceShare({
  recordId,
  enabled = true,
}: {
  recordId: RecordId
  enabled?: boolean
}) {
  const utils = api.useUtils()

  const { data: rows = [], isLoading } = api.resourceAccess.forInstance.useQuery(
    { recordId },
    { enabled: enabled && !!recordId }
  )

  const invalidate = () => utils.resourceAccess.forInstance.invalidate({ recordId })

  const setRows = (updater: (rows: ResourceAccessInfo[]) => ResourceAccessInfo[]) => {
    utils.resourceAccess.forInstance.setData({ recordId }, (prev) => updater(prev ?? []))
  }

  const optimisticRow = (
    granteeType: ResourceGranteeType,
    granteeId: string,
    rung: Rung
  ): ResourceAccessInfo => ({
    id: `optimistic-${granteeType}-${granteeId}`,
    entityDefinitionId: recordId.split(':')[0] ?? '',
    entityInstanceId: recordId.split(':')[1] ?? null,
    granteeType,
    granteeId,
    rung,
    createdAt: new Date(),
  })

  const grantInstance = api.resourceAccess.grantInstance.useMutation({
    onMutate: async (input) => {
      await utils.resourceAccess.forInstance.cancel({ recordId })
      const previous = utils.resourceAccess.forInstance.getData({ recordId })
      setRows((rows) => [
        optimisticRow(input.granteeType, input.granteeId, input.rung),
        ...rows.filter(
          (r) => !(r.granteeType === input.granteeType && r.granteeId === input.granteeId)
        ),
      ])
      return { previous }
    },
    onError: (error, _input, context) => {
      utils.resourceAccess.forInstance.setData({ recordId }, context?.previous)
      toastError({ title: 'Error updating access', description: error.message })
    },
    onSettled: invalidate,
  })

  const revokeInstance = api.resourceAccess.revokeInstance.useMutation({
    onMutate: async (input) => {
      await utils.resourceAccess.forInstance.cancel({ recordId })
      const previous = utils.resourceAccess.forInstance.getData({ recordId })
      setRows((rows) =>
        rows.filter(
          (r) => !(r.granteeType === input.granteeType && r.granteeId === input.granteeId)
        )
      )
      return { previous }
    },
    onError: (error, _input, context) => {
      utils.resourceAccess.forInstance.setData({ recordId }, context?.previous)
      toastError({ title: 'Error removing access', description: error.message })
    },
    onSettled: invalidate,
  })

  /** Actor-keyed user/group grants (excludes the workspace baseline row). */
  const grants = useMemo<InstanceShareGrant[]>(
    () =>
      rows.flatMap((r) => {
        const actorId = granteeToActorId(r.granteeType, r.granteeId)
        if (!actorId) return []
        return [
          {
            actorId,
            choice: r.rung as InstanceLevel,
            rung: r.rung,
            granteeAreaLevel: r.granteeAreaLevel,
          },
        ]
      }),
    [rows]
  )

  /**
   * Rows this card can neither render as an actor nor revoke — a `profile`
   * grantee today (plan 19 §8.2), any future kind tomorrow. Surfaced rather than
   * dropped: silently filtering them told the admin "not shared with anyone"
   * while a live grant existed server-side, so they could not see OR revoke it.
   */
  const unmanageableGrants = useMemo<UnmanageableGrant[]>(
    () =>
      rows
        .filter(
          (r) =>
            !isActorGrantee(r.granteeType) &&
            !(
              r.granteeType === WORKSPACE_GRANTEE.granteeType &&
              r.granteeId === WORKSPACE_GRANTEE.granteeId
            )
        )
        .map((r) => ({ granteeType: r.granteeType, granteeId: r.granteeId })),
    [rows]
  )

  /** The workspace baseline (`role:org_member`) row, if one exists. */
  const baselineRow = useMemo(
    () =>
      rows.find(
        (r) =>
          r.granteeType === WORKSPACE_GRANTEE.granteeType &&
          r.granteeId === WORKSPACE_GRANTEE.granteeId
      ),
    [rows]
  )

  const baseline: WorkspaceBaseline = baselineRow
    ? baselineRow.rung === 'none'
      ? 'restricted'
      : (baselineRow.rung as InstanceLevel)
    : undefined

  /**
   * Grant or change a user/group's level (upsert) — ONE row, exactly the one the
   * admin asked for.
   *
   * It used to also write a `role:org_member @ view` baseline on the first
   * explicit row, "so the rest of the org keeps its base-level access instead of
   * silently losing it". That was a compensation for a defect one layer down:
   * `effectiveInstanceLevel` treated "carries ≥1 row for anyone" as "restricted",
   * so the first share genuinely did privatize the instance. The resolver now
   * distinguishes SHARING from RESTRICTING (`governingInstanceIds` — a
   * `role:org_member` row or a `none` marker), so there is nothing left to
   * compensate for, and writing an unrequested baseline row would now be a real
   * side effect: it would move the instance INTO the governing set and pin it to
   * Read for members whose area level is higher.
   *
   * An ActorId with no grantee representation is REFUSED, not coerced: the old
   * `type === 'group' ? group : user` fall-through turned an `agent:`/`worker:`
   * pick into a `user` row keyed on an `Agent.id`/`DispatchWorker.id` — a row
   * pointing at the wrong table that no resolver matches and no admin can see.
   */
  const grant = (actorId: ActorId, choice: InstanceLevel) => {
    const grantee = actorIdToGrantee(actorId)
    if (!grantee) {
      toastError({
        title: 'Cannot share with this actor',
        description: GRANTEE_UNSUPPORTED_MESSAGE,
      })
      return
    }
    grantInstance.mutate({ recordId, ...grantee, rung: choice })
  }

  const revoke = (actorId: ActorId) => {
    const grantee = actorIdToGrantee(actorId)
    if (!grantee) {
      toastError({ title: 'Cannot remove this access', description: GRANTEE_UNSUPPORTED_MESSAGE })
      return
    }
    revokeInstance.mutate({ recordId, ...grantee })
  }

  /** Set the workspace baseline. `'restricted'` writes the `'none'` marker. */
  const setBaseline = (next: InstanceLevel | 'restricted') => {
    grantInstance.mutate({
      recordId,
      granteeType: WORKSPACE_GRANTEE.granteeType,
      granteeId: WORKSPACE_GRANTEE.granteeId,
      rung: next === 'restricted' ? 'none' : next,
    })
  }

  return {
    grants,
    unmanageableGrants,
    baseline,
    isLoading,
    grant,
    changeLevel: grant,
    revoke,
    setBaseline,
    isMutating: grantInstance.isPending || revokeInstance.isPending,
  }
}
