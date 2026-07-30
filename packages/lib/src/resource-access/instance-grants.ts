// packages/lib/src/resource-access/instance-grants.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { isGoverningInstanceRow } from '../cache/providers/governing-instance-ids-provider'
import { RUNG_ORDER } from '../permissions/capabilities/rung'
import type { ResourceAccessGrantees } from './grantee-resolution'
import { resourceAccessGranteeConditions } from './grantee-resolution'

/**
 * The `ResourceAccess` columns every instance-grant reader needs (plan v3/03
 * §12, P4).
 *
 * One row shape, because there is now one query: {@link loadUserInstanceGrants}.
 * `granteeType`/`granteeId` are not optional extras — they are what sorts a row
 * into the INDIVIDUAL or BASELINE lane and what makes it a governing row, and
 * both distinctions are load-bearing in BOTH composed blobs.
 */
export interface InstanceGrantRow {
  entityDefinitionId: string
  entityInstanceId: string
  granteeType: string
  granteeId: string
  rung: Rung
}

/**
 * The grantee kinds whose `ResourceAccess` rows are a grant addressed to THIS
 * member, rather than the org-wide default (plan 43 §0.2a). Only these bypass
 * the area gate in `effectiveInstanceLevel`.
 *
 * **An ALLOWLIST, not `!== 'role'`, and that is the whole point.** A denylist
 * sorts an unrecognized grantee kind into the INDIVIDUAL lane, which is the
 * UNGATED one, so adding a kind to the storage vocabulary would silently wave it
 * past the area level. With an allowlist the unknown kind is gated instead: it
 * resolves through the baseline path, which is the failure direction we can live
 * with.
 *
 * Same hazard `governingInstanceIdsProvider` records — *"Adding a grantee kind to
 * the storage vocabulary still means adding it to every reader in the same
 * change."* This is now ONE reader instead of two, which is the point of P4.
 */
const INDIVIDUAL_GRANTEE_TYPES: ReadonlySet<string> = new Set(['user', 'group', 'profile'])

/** Whether a row is an individual grant — see {@link INDIVIDUAL_GRANTEE_TYPES}. */
export function isIndividualGranteeType(granteeType: string): boolean {
  return INDIVIDUAL_GRANTEE_TYPES.has(granteeType)
}

/** `entityDefinitionId → entityInstanceId → highest rung`. */
export type DefKeyedRungs = Record<string, Record<string, Rung>>

/**
 * One member's instance-level grants, bucketed ONCE (plan v3/03 §12, P4).
 *
 * Both composed blobs are projections of this value: `composeUserCapabilities`
 * flattens the two lanes over the BLOB-LANE resource keys, and
 * `composeUserInstanceGrants` folds the inbox defs into a lens floor and keeps
 * the rest def-keyed. Before P4 each composer walked the rows itself, with its
 * own def filter in SQL and its own idea of which grantee kinds count — the
 * arrangement that let the `team` grantee kind reach mail and not capabilities.
 *
 * Def-keyed on BOTH lanes, deliberately. `entityInstanceId` is globally unique,
 * so a flat map would work for lookups — but then "which resource is this a
 * grant for" is unanswerable, and that question is what keeps a dashboard grant
 * from opening the workflows front door and a record grant out of the mail
 * buckets.
 */
export interface BucketedInstanceGrants {
  /** INDIVIDUAL grantee rows (`user` / `group` / `profile`). Never area-gated. */
  individual: DefKeyedRungs
  /** BASELINE rows (`role:org_member`) — the org-wide workspace default. */
  baseline: DefKeyedRungs
  /**
   * Instance ids carrying a GOVERNING row for this member — a baseline row at
   * any rung, or any `'none'` row (`isGoverningInstanceRow`). The signal that an
   * instance's org-wide default is AUTHORED, so the L2 area fallback stands down.
   *
   * Per-member by construction: the query is grantee-filtered, so another
   * member's personal `'none'` row never lands here. The org-wide twin is the
   * `governingInstanceIds` org-cache key, built from the same predicate.
   */
  governing: Record<string, true>
}

function raise(map: DefKeyedRungs, defId: string, instanceId: string, rung: Rung): void {
  const byInstance = (map[defId] ??= {})
  const existing = byInstance[instanceId]
  if (!existing || RUNG_ORDER[rung] > RUNG_ORDER[existing]) byInstance[instanceId] = rung
}

/**
 * **THE bucketing pass** (plan v3/03 §12, P4) — instance-level `ResourceAccess`
 * rows in, the two lanes plus the governing set out.
 *
 * `'none'` is KEPT in both lanes. It is the per-instance downward marker —
 * personal in the individual lane, workspace-wide in the baseline lane — and a
 * real grant outranks it via {@link RUNG_ORDER}. Consumers that want positive
 * grants only drop it at projection time; dropping it here would erase the
 * restriction (`project_permission_none_is_a_restriction`).
 *
 * The lanes are never merged, and that is the whole point: only the baseline lane
 * is gated by the area level (plan 43 §0.2a).
 */
export function bucketInstanceGrantRows(rows: readonly InstanceGrantRow[]): BucketedInstanceGrants {
  const bucket: BucketedInstanceGrants = { individual: {}, baseline: {}, governing: {} }
  for (const row of rows) {
    if (!row.entityInstanceId) continue
    const lane = isIndividualGranteeType(row.granteeType) ? bucket.individual : bucket.baseline
    raise(lane, row.entityDefinitionId, row.entityInstanceId, row.rung)
    if (isGoverningInstanceRow(row)) bucket.governing[row.entityInstanceId] = true
  }
  return bucket
}

/**
 * The highest rung this member holds on `instanceId` for `defId`, across both
 * lanes. `undefined` when no row of either lane names it.
 *
 * Lane-blind on purpose: the callers that must distinguish the lanes (mail's
 * inbox floor, `effectiveInstanceLevel`) read the maps directly, and everyone
 * else wants "did anything reach me".
 */
export function mergedRung(
  bucket: BucketedInstanceGrants,
  defId: string,
  instanceId: string
): Rung | undefined {
  const own = bucket.individual[defId]?.[instanceId]
  const base = bucket.baseline[defId]?.[instanceId]
  if (own === undefined) return base
  if (base === undefined) return own
  return RUNG_ORDER[own] >= RUNG_ORDER[base] ? own : base
}

/** Every def key present in either lane. */
export function grantedDefIds(bucket: BucketedInstanceGrants): string[] {
  return [...new Set([...Object.keys(bucket.individual), ...Object.keys(bucket.baseline)])]
}

/**
 * **THE instance-level grant query** (plan v3/03 §11 — "one of the two
 * overlapping instance-level compose queries" is deleted here).
 *
 * One query, one grantee union, one bucketing pass, feeding both composed blobs.
 * Three things about its shape are deliberate:
 *
 *  - **No `entityDefinitionId` filter.** The capability composer used to push
 *    `IN (INSTANCE_ACCESS_KEYS)` into SQL while the mail composer selected every
 *    def; unified, the wider query wins and the narrowing moves into the
 *    projections (`isInstanceAccessKey` for capabilities). That keeps the
 *    "records never enter `instanceDerivedKeys`" invariant expressed in code,
 *    where it is testable, rather than in a WHERE clause per reader.
 *  - **`resourceAccessGranteeConditions`, never an inline union.** The invariant
 *    is *every reader enumerates every grantee kind*; a shared builder enforces
 *    it structurally. The inline union in `computeUserCapabilities` is what let
 *    `team` reach mail and not capabilities (19a finding 4 in the forward
 *    direction).
 *  - **`treatTeamAsGroup: true` for both readers.** That was mail's historical
 *    behaviour and capabilities' divergence; unifying upward is what §11 means by
 *    "deletes the `team` divergence". A legacy `team` row now reaches the
 *    capability blob as well, which is the direction that makes the forward
 *    resolver agree with `expandGranteeToUserIds` (whose `team` branch has always
 *    resolved to group members).
 *
 * Instance-level only (`entityInstanceId IS NOT NULL`): type-level grants must
 * not derive to instances (April decision — "view all contacts" doesn't expose
 * every thread), and the type-level read is a separate projection with a
 * separate meaning (`defAccess`).
 */
export async function loadUserInstanceGrants(
  db: Database,
  organizationId: string,
  grantees: ResourceAccessGrantees
): Promise<BucketedInstanceGrants> {
  const rows = await db
    .select({
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      entityInstanceId: schema.ResourceAccess.entityInstanceId,
      granteeType: schema.ResourceAccess.granteeType,
      granteeId: schema.ResourceAccess.granteeId,
      rung: schema.ResourceAccess.rung,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        isNotNull(schema.ResourceAccess.entityInstanceId),
        or(...resourceAccessGranteeConditions(grantees, { treatTeamAsGroup: true }))
      )
    )

  return bucketInstanceGrantRows(rows as InstanceGrantRow[])
}
