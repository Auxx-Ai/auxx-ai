// packages/lib/src/permissions/profiles/agent-policy-clamp.ts

import type {
  AgentPolicyClampEntry,
  ExactAgentPolicy,
  PublishedAgentPermissionPolicy,
} from '@auxx/database'
import type { ResourcePermission } from '@auxx/database/enums'
import type { CapabilityView } from '../capabilities/capability-view'
import { PERMISSION_RANK } from '../capabilities/compose-user-capabilities'
import { INSTANCE_ACCESS_KEYS, type InstanceAccessKey } from '../capabilities/instance-access'
import { AREA_ORDER } from '../capabilities/registry'
import { areaLevelToPermission, lookupExactPolicy, minPermission } from './agent-policy'

/**
 * A definition the clamp must bound, in the two keyspaces it needs: the policy is
 * keyed by `apiSlug`, while the publisher's own gates are keyed by the canonical
 * `entityDefinitionId`.
 */
export interface ClampDefinition {
  apiSlug: string
  entityDefinitionId: string
}

/**
 * A def/instance id that provably does not exist, used to probe the publisher's
 * posture toward a target they have never been granted anything on.
 *
 * This is the trick that makes the `default` rungs clampable at all. A snapshot's
 * `default` has to answer for definitions and resources created *after*
 * publication, so there is no real key to test — but the publisher's own resolver
 * already computes exactly that answer for an unknown id: it is not in
 * `restrictedEntityDefIds` / `restrictedInstanceIds`, so it falls through to their
 * base area posture. Probing with a sentinel therefore reads the publisher's
 * "authority over a thing I've never seen" straight out of the human composer,
 * instead of us re-deriving it (and drifting from it).
 */
const FUTURE_TARGET_SENTINEL = '__auxx_unknown_target_for_author_clamp__'

/** Rank comparison — `true` when `candidate` sits strictly above `bound`. */
function exceeds(candidate: ResourcePermission, bound: ResourcePermission): boolean {
  return PERMISSION_RANK[candidate] > PERMISSION_RANK[bound]
}

/**
 * `Object.entries` over a `Partial<Record<…>>`, narrowed to present values.
 * `overrides` is sparse by design, so the raw entries type is
 * `[string, ResourcePermission | undefined]` even though an `undefined` value can
 * never actually appear.
 */
function overrideEntries(policy: ExactAgentPolicy): Array<[string, ResourcePermission]> {
  return Object.entries(policy.overrides).filter(
    (entry): entry is [string, ResourcePermission] => entry[1] !== undefined
  )
}

/**
 * The publisher's own effective rung for a DEFINITION, expressed on the agent
 * ladder — read by probing their gates in descending order.
 *
 * Probing rather than reading a level directly is the whole point: `canAdministerDef`
 * / `canEditEntity` / `canViewEntity` ARE the human enforcement path (OWNER/ADMIN
 * bypass, `defBaseOverrides`, restricted-vs-open resolution, the seat ceiling and
 * all), so the clamp can never disagree with what the publisher is actually
 * allowed to do. Any future change to human def resolution is inherited for free.
 */
function publisherDefinitionLevel(
  publisher: CapabilityView,
  entityDefId: string
): ResourcePermission {
  if (publisher.canAdministerDef(entityDefId)) return 'admin'
  if (publisher.canEditEntity(entityDefId)) return 'edit'
  if (publisher.canViewEntity(entityDefId)) return 'view'
  return 'none'
}

/** The publisher's own effective rung for one resource instance, same probe idiom. */
function publisherInstanceLevel(
  publisher: CapabilityView,
  key: InstanceAccessKey,
  instanceId: string
): ResourcePermission {
  if (publisher.canAdminInstance(key, instanceId)) return 'admin'
  if (publisher.canEditInstance(key, instanceId)) return 'edit'
  if (publisher.canViewInstance(key, instanceId)) return 'view'
  return 'none'
}

/** The result of a clamped publish — the snapshot to store plus what it reduced. */
export interface ClampedAgentPolicy {
  policy: PublishedAgentPermissionPolicy
  /**
   * Every reduction, for the publish UI and the audit trail. Empty when the
   * publisher held everything the profile asked for (the OWNER/ADMIN case).
   */
  reductions: AgentPolicyClampEntry[]
}

/**
 * **The author clamp** (plan 19 §2.4a): an agent may not be published with more
 * authority than the human publishing it holds.
 *
 * ```
 * publishedPolicy = min(resolvedProfilePolicy, publisherEffectiveCapabilities)
 * ```
 *
 * applied per area, per definition, and per resource instance.
 *
 * **Why this exists.** `PermissionKey.agentsManage` is the `agents` area's `Full`
 * rung and it is grantable to a non-admin; every procedure in the agent tRPC
 * router — `create`, `update`, `publish`, `restoreVersion`, `completeSetup` —
 * gates on exactly that key. Meanwhile the seeded `agent` system profile is
 * deliberately permissive (areas/definitions/resources all `Full`). Without this
 * clamp a member holding only `agentsManage` could create an internal agent,
 * never touch a permission profile, obtain an all-`Full` principal, and invoke
 * it — a general privilege-escalation proxy that routes around §0.23 ("you may
 * only write or assign access you already hold") through a non-human principal.
 *
 * **It reuses the human composer, it does not reimplement it.** Every bound comes
 * from calling the publisher's OWN {@link CapabilityView} gates
 * (`areaLevel`, `canViewEntity`/`canEditEntity`/`canAdministerDef`,
 * `canView/Edit/AdminInstance`). That is deliberate — a guard that re-derives what
 * it is guarding is how a guard and its enforcement drift apart. It also means
 * OWNER/ADMIN fall out correctly with no special case: their gates answer `true`
 * everywhere, so every comparison is vacuous and the clamp is a no-op. **An
 * OWNER/ADMIN publishing widens legitimately** — that is the intended escape
 * hatch (§2.4a).
 *
 * **What is deliberately NOT done here:** the clamp is a publish-time act, never a
 * live one. A publisher who is later demoted leaves a snapshot above their current
 * authority, by design — re-clamping live against a mutable human would silently
 * break running automations on a role change. Drift is bounded by the next
 * publish (which re-clamps) and made auditable by `publishedByUserId`. An org
 * wanting hard revocation republishes.
 *
 * @param resolved - The total policy resolved from the draft profile binding.
 * @param publisher - The publishing human's own effective capabilities, or `null`
 *   for a system publish (no clamp; recorded as `publishedByUserId: null`).
 * @param publisherUserId - Recorded on the snapshot for audit.
 * @param definitions - The org's current definitions, in both keyspaces. Only
 *   these are materialized as overrides; the retained `definitions.default`
 *   (itself clamped by the sentinel probe) answers for definitions created later.
 * @returns The snapshot to persist plus the reductions to surface.
 */
export function clampAgentPolicyToPublisher(input: {
  resolved: PublishedAgentPermissionPolicy
  publisher: CapabilityView | null
  publisherUserId: string | null
  definitions: readonly ClampDefinition[]
}): ClampedAgentPolicy {
  const { resolved, publisher, publisherUserId, definitions } = input

  if (!publisher) {
    return {
      policy: { ...resolved, publishedByUserId: publisherUserId, clamp: [] },
      reductions: [],
    }
  }

  const reductions: AgentPolicyClampEntry[] = []
  const record = (
    domain: AgentPolicyClampEntry['domain'],
    key: string | null,
    from: ResourcePermission,
    to: ResourcePermission
  ) => {
    reductions.push({ domain, key, from, to })
  }

  // ── Areas ────────────────────────────────────────────────────────────────
  // Every area is materialized, so each current area's bound is exact. The
  // retained `default` is clamped to the publisher's WEAKEST area rung, because
  // it must answer for an area a future deploy adds and no probe can know that
  // area's posture in advance. Conservative on purpose: a security clamp's
  // unknown case belongs on the low side, and for an ADMIN publisher (all-Full)
  // the minimum is `admin`, so the intended escape hatch is unaffected.
  const areaOverrides: Record<string, ResourcePermission> = {}
  let weakestPublisherArea: ResourcePermission = 'admin'
  for (const area of AREA_ORDER) {
    const want = lookupExactPolicy(resolved.areas, area)
    const bound = areaLevelToPermission(publisher.areaLevel(area))
    weakestPublisherArea = minPermission(weakestPublisherArea, bound)
    const got = minPermission(want, bound)
    areaOverrides[area] = got
    if (exceeds(want, got)) record('area', area, want, got)
  }
  const areasDefault = minPermission(resolved.areas.default, weakestPublisherArea)
  if (exceeds(resolved.areas.default, areasDefault)) {
    record('area', null, resolved.areas.default, areasDefault)
  }

  // ── Definitions ──────────────────────────────────────────────────────────
  const definitionOverrides: Record<string, ResourcePermission> = {}
  for (const def of definitions) {
    const want = lookupExactPolicy(resolved.definitions, def.apiSlug)
    const bound = publisherDefinitionLevel(publisher, def.entityDefinitionId)
    const got = minPermission(want, bound)
    definitionOverrides[def.apiSlug] = got
    if (exceeds(want, got)) record('definition', def.apiSlug, want, got)
  }
  // Carry any override naming a definition that no longer exists (archived, or
  // a slug awaiting recreation) rather than dropping it — §3's slug lifecycle
  // says a dangling override must survive archive/restore. Bound it by the
  // publisher's unknown-target posture, since there is no def to probe.
  const definitionSentinelBound = publisherDefinitionLevel(publisher, FUTURE_TARGET_SENTINEL)
  for (const [apiSlug, want] of overrideEntries(resolved.definitions)) {
    if (apiSlug in definitionOverrides) continue
    const got = minPermission(want, definitionSentinelBound)
    definitionOverrides[apiSlug] = got
    if (exceeds(want, got)) record('definition', apiSlug, want, got)
  }
  const definitionsDefault = minPermission(resolved.definitions.default, definitionSentinelBound)
  if (exceeds(resolved.definitions.default, definitionsDefault)) {
    record('definition', null, resolved.definitions.default, definitionsDefault)
  }

  // ── Resource instances ───────────────────────────────────────────────────
  // Instances are org data and unbounded in count, so only the ids the policy
  // actually names are probed; each type's `default` is bounded by the sentinel
  // probe, which is precisely the publisher's posture toward an instance created
  // after publication.
  const resources: Record<string, ExactAgentPolicy> = {}
  let resourceDefault = resolved.resourceDefault
  for (const key of INSTANCE_ACCESS_KEYS) {
    const forType = resolved.resources[key]
    const typeDefaultWant = forType?.default ?? resolved.resourceDefault
    const typeBound = publisherInstanceLevel(publisher, key, FUTURE_TARGET_SENTINEL)
    const typeDefaultGot = minPermission(typeDefaultWant, typeBound)
    if (exceeds(typeDefaultWant, typeDefaultGot)) {
      record('resource', key, typeDefaultWant, typeDefaultGot)
    }

    const overrides: Record<string, ResourcePermission> = {}
    for (const [instanceId, want] of forType ? overrideEntries(forType) : []) {
      const bound = publisherInstanceLevel(publisher, key, instanceId)
      const got = minPermission(want, bound)
      overrides[instanceId] = got
      if (exceeds(want, got)) record('resource', `${key}:${instanceId}`, want, got)
    }

    resources[key] = { default: typeDefaultGot, overrides }
    // Every registered type is now materialized, so `resourceDefault` only ever
    // answers for a resource type added by a future deploy. Floor it.
    resourceDefault = minPermission(resourceDefault, typeBound)
  }
  if (exceeds(resolved.resourceDefault, resourceDefault)) {
    record('resource', null, resolved.resourceDefault, resourceDefault)
  }

  // Preserve rules for any resource type the registry does not (yet) know, rather
  // than silently discarding a snapshot entry — but clamp them by the floored
  // `resourceDefault`. There is no gate to probe for an unregistered type, and
  // carrying an UNCLAMPED rule through the clamp would be a hole by omission.
  for (const [type, forType] of Object.entries(resolved.resources)) {
    if (type in resources || !forType) continue
    const overrides: Record<string, ResourcePermission> = {}
    for (const [instanceId, want] of overrideEntries(forType)) {
      overrides[instanceId] = minPermission(want, resourceDefault)
    }
    resources[type] = {
      default: minPermission(forType.default, resourceDefault),
      overrides,
    }
  }

  return {
    policy: {
      sourceProfileId: resolved.sourceProfileId,
      sourceProfileUpdatedAt: resolved.sourceProfileUpdatedAt,
      publishedByUserId: publisherUserId,
      clamp: reductions,
      areas: { default: areasDefault, overrides: areaOverrides },
      definitions: { default: definitionsDefault, overrides: definitionOverrides },
      resourceDefault,
      resources,
    },
    reductions,
  }
}
