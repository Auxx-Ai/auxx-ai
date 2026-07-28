// packages/lib/src/permissions/profiles/agent-policy.ts

import type {
  AgentKind,
  AgentPermissionPolicy,
  ExactAgentPolicy,
  PublishedAgentPermissionPolicy,
} from '@auxx/database'
import { type ResourcePermission, ResourcePermissionValues } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { PERMISSION_RANK } from '../capabilities/compose-user-capabilities'
import { INSTANCE_ACCESS_RESOURCES, type InstanceAccessKey } from '../capabilities/instance-access'
import { AREA_ORDER, type Area, clampLevelToArea, Level } from '../capabilities/registry'
import { systemProfileForAgentKind } from './system-profiles'
import type { CachedPermissionProfile } from './types'

const logger = createScopedLogger('agent-permission-policy')

/**
 * Ascending ladder order — `POLICY_LADDER[rank]`, the inverse of
 * {@link PERMISSION_RANK}.
 *
 * The rungs are {@link ResourcePermission} — the same `none/view/edit/admin`
 * strings every `ResourceAccess` row is stored in (plan 26 Phase 2). Agent policy
 * used to spell them `none/read/read_write/full`, which made every boundary
 * between it and the rest of the permission model a bijection to cross; those
 * conversions are deleted.
 *
 * What did NOT collapse with the spelling is the meaning of the bottom rung.
 * `PERMISSION_RANK` ranks `'none'` at 0 for both vocabularies, but in the additive
 * human reducers a stored `'none'` is a grant-row marker that grants nobody and is
 * SKIPPED, while here it is LOAD-BEARING — it removes authority (plan 19 §0.5),
 * which is exactly why an agent policy must never be fed to those reducers.
 */
const POLICY_LADDER: readonly ResourcePermission[] = ['none', 'view', 'edit', 'admin']

/** The lower of two exact rungs — the primitive every intersection is built on. */
export function minPermission(a: ResourcePermission, b: ResourcePermission): ResourcePermission {
  return PERMISSION_RANK[a] <= PERMISSION_RANK[b] ? a : b
}

/**
 * The rung→ladder mapping of plan 19 §2.3, area half:
 *
 * | Stored rung | Area `Level` |
 * |---|---|
 * | `none`  | `Level.None` |
 * | `view`  | `Level.Read` |
 * | `edit`  | `Level.Edit` |
 * | `admin` | `Level.Full` |
 *
 * `Level` stays numeric on purpose — composition's max/min comparisons are by
 * design (plan 26 §2.6), so this is the one conversion the collapse keeps.
 * Written out rather than derived from {@link PERMISSION_RANK}: the two tables
 * happen to agree numerically today, and a silent reorder of a *ranking* table
 * must not be able to shift an *area rung*.
 */
const AREA_LEVEL_OF_PERMISSION: Record<ResourcePermission, Level> = {
  none: Level.None,
  view: Level.Read,
  edit: Level.Edit,
  admin: Level.Full,
}

export function permissionToAreaLevel(permission: ResourcePermission): Level {
  return AREA_LEVEL_OF_PERMISSION[permission]
}

/** Inverse of {@link permissionToAreaLevel} — used by the publish-time clamp. */
export function areaLevelToPermission(level: Level): ResourcePermission {
  return POLICY_LADDER[Math.min(POLICY_LADDER.length - 1, Math.max(0, level))] ?? 'none'
}

/**
 * An authored rung expressed on the area's OWN ladder (plan 19 §2.3 + the
 * registry's per-area rungs).
 *
 * The policy is authored on the flat four-rung vocabulary, but an area's ladder
 * can be shorter: `auditLog` tops out at `Read`, `files`/`billing` skip `Edit`.
 * `'admin'` on `auditLog` therefore is not authority the agent has and the human
 * lacks — `expandLevelsToKeys` composes both to `auditLogView`. Normalizing here
 * keeps the clamp comparing like with like, so an OWNER (whose composed rung on
 * `auditLog` is `Read`, the ceiling) no longer reads as "reduced".
 */
export function clampPermissionToArea(
  area: Area,
  permission: ResourcePermission
): ResourcePermission {
  return areaLevelToPermission(clampLevelToArea(area, permissionToAreaLevel(permission)))
}

/**
 * Look one key up in an exact policy. There is **no run-time `inherit`**: an
 * override wins, otherwise the keyspace's explicit `default` answers, so every
 * lookup returns exactly one of the four rungs (plan 19 §2.3).
 */
export function lookupExactPolicy(policy: ExactAgentPolicy, key: string): ResourcePermission {
  return policy.overrides[key] ?? policy.default
}

/** The published area rung for one capability area. */
export function policyAreaLevel(
  policy: PublishedAgentPermissionPolicy,
  area: Area | string
): ResourcePermission {
  return lookupExactPolicy(policy.areas, area)
}

/** The published definition rung for one entity `apiSlug`. */
export function policyDefinitionLevel(
  policy: PublishedAgentPermissionPolicy,
  apiSlug: string
): ResourcePermission {
  return lookupExactPolicy(policy.definitions, apiSlug)
}

/**
 * The rung a resource type falls through to when the policy names no rule for it
 * — its own L2 area, which is the *human* model's fallback verbatim
 * (`INSTANCE_ACCESS_RESOURCES`: for `baselineAtCreate: false` resources "an
 * absent instance row → the base L2 area level").
 *
 * This is what replaced a top-level `resourceDefault` field. That field answered
 * the same question a second time, one level up from the area rung it was then
 * intersected with, so the editor had to offer two blanket dropdowns whose
 * difference nobody could state — and an `All datasets` row could read
 * *"Default · None"* under a `Datasets: Read` area, contradicting its own parent.
 *
 * An UNREGISTERED type (a snapshot naming a resource kind this deploy no longer
 * has) has no area to ask, so it fails closed at `'none'`. It is inert either
 * way — nothing can call `canViewInstance` for a key the registry dropped.
 */
function resourceTypeAreaLevel(
  policy: PublishedAgentPermissionPolicy,
  resourceType: string
): ResourcePermission {
  const config = INSTANCE_ACCESS_RESOURCES[resourceType as InstanceAccessKey]
  return config ? policyAreaLevel(policy, config.area) : 'none'
}

/**
 * The published rung for one resource instance: the most specific rule that
 * names it, intersected with its coarse L2 area gate.
 *
 * The intersection is the whole composition model in one line (§0.5) — an area
 * of `None` closes the feature no matter what a stale instance rule says — and it
 * is also what makes the snapshot total. A type with no entry, or a type added by
 * a deploy that postdates publication, resolves through
 * {@link resourceTypeAreaLevel} to the area rung, which `areas.default` already
 * answers for an area the snapshot predates.
 */
export function policyResourceLevel(
  policy: PublishedAgentPermissionPolicy,
  resourceType: string,
  instanceId: string
): ResourcePermission {
  const areaGate = resourceTypeAreaLevel(policy, resourceType)
  const forType = policy.resources[resourceType]
  if (!forType) return areaGate
  return minPermission(lookupExactPolicy(forType, instanceId), areaGate)
}

/** Coerce an arbitrary stored value into the closed rung vocabulary, or `null`. */
export function parsePolicyPermission(raw: unknown): ResourcePermission | null {
  return typeof raw === 'string' && (ResourcePermissionValues as readonly string[]).includes(raw)
    ? (raw as ResourcePermission)
    : null
}

/**
 * Defensively coerce a stored exact-policy jsonb into the trusted shape. An
 * unusable `default` falls back to `fallbackDefault`; override entries outside
 * the closed vocabulary are DROPPED (they then read as the default) rather than
 * guessed at.
 */
function parseExactPolicy(raw: unknown, fallbackDefault: ResourcePermission): ExactAgentPolicy {
  const source = (raw ?? {}) as { default?: unknown; overrides?: unknown }
  const parsedDefault = parsePolicyPermission(source.default) ?? fallbackDefault

  const overrides: Record<string, ResourcePermission> = {}
  if (source.overrides && typeof source.overrides === 'object') {
    for (const [key, value] of Object.entries(source.overrides as Record<string, unknown>)) {
      const level = parsePolicyPermission(value)
      if (level) overrides[key] = level
    }
  }

  return { default: parsedDefault, overrides }
}

/**
 * Coerce a stored `AgentVersion.permissionPolicy` into a trusted, TOTAL
 * {@link PublishedAgentPermissionPolicy}.
 *
 * The column is `NOT NULL` and publish validates every value before writing, so
 * in practice this is a cheap pass-through. It exists because the column is jsonb
 * and a hand-written row, a future shape change, or a partially-migrated blob
 * must resolve to *something* deterministic rather than throwing inside a run —
 * and the safe direction for an unreadable policy is `'none'`, not `'admin'`.
 *
 * @param raw - The stored jsonb value.
 * @param fallbackDefault - Rung to use for an unreadable `default`. Defaults to
 *   `'none'` (fail closed). Pass `'admin'` only where preserving legacy behavior
 *   is the explicit intent.
 */
export function parsePublishedAgentPolicy(
  raw: unknown,
  fallbackDefault: ResourcePermission = 'none'
): PublishedAgentPermissionPolicy {
  const source = (raw ?? {}) as Partial<PublishedAgentPermissionPolicy> & {
    resources?: unknown
    clamp?: unknown
  }

  // A type entry whose own `default` is unreadable falls back to `fallbackDefault`
  // (`'none'`), NOT to its area rung: the area fall-through is for a type with no
  // entry at all, and a corrupt entry must not read as a wider rule than the
  // absence it replaced.
  const resources: Record<string, ExactAgentPolicy> = {}
  if (source.resources && typeof source.resources === 'object') {
    for (const [type, value] of Object.entries(source.resources as Record<string, unknown>)) {
      resources[type] = parseExactPolicy(value, fallbackDefault)
    }
  }

  return {
    sourceProfileId: typeof source.sourceProfileId === 'string' ? source.sourceProfileId : null,
    sourceProfileUpdatedAt:
      typeof source.sourceProfileUpdatedAt === 'string' ? source.sourceProfileUpdatedAt : null,
    publishedByUserId:
      typeof source.publishedByUserId === 'string' ? source.publishedByUserId : null,
    clamp: Array.isArray(source.clamp) ? source.clamp : [],
    areas: parseExactPolicy(source.areas, fallbackDefault),
    definitions: parseExactPolicy(source.definitions, fallbackDefault),
    resources,
  }
}

/**
 * Coerce an authored `PermissionProfile.agentPolicy` into the trusted shape
 * before it is stored.
 *
 * This is the real gate on the profile-save path — the router's zod input only
 * checks the envelope, exactly as `parseAreaLevels` is the gate for human
 * `levels`. Values outside the closed rung vocabulary are DROPPED (the key then
 * reads as its collection default) and an unreadable `default` falls back to
 * `'none'`, so a malformed payload can only ever narrow authority, never widen
 * it.
 */
export function parseAgentPolicy(raw: unknown): AgentPermissionPolicy {
  return authorizationOnlyPolicy(parsePublishedAgentPolicy(raw))
}

/**
 * The authorization-only projection of a policy — everything that decides what
 * the agent may do, and nothing that merely records who published it.
 *
 * This is what `configHash` hashes (plan 19 §8.1). Excluding
 * `publishedByUserId` / `sourceProfileUpdatedAt` / `clamp` is load-bearing: if
 * the byline were hashed, re-publishing byte-identical authority under a
 * different editor would mint a pointless new version and break the no-op
 * republish check. Conversely a genuine clamp CHANGE always alters
 * `areas`/`definitions`/`resources`, so a re-clamp after a demotion still
 * produces a new version — which is the §2.4a requirement.
 *
 * Keys are emitted in a fixed order; the hash itself is stable-stringified
 * upstream, so a jsonb round-trip that reorders keys still hashes identically.
 */
export function authorizationOnlyPolicy(policy: PublishedAgentPermissionPolicy): {
  areas: ExactAgentPolicy
  definitions: ExactAgentPolicy
  resources: Partial<Record<string, ExactAgentPolicy>>
} {
  return {
    areas: policy.areas,
    definitions: policy.definitions,
    resources: policy.resources,
  }
}

/**
 * The all-`admin` policy that preserves today's dormant agent posture — every agent
 * currently composes `Level.Full` on every area with no explicit grant row
 * (plan 14 §0.3), so "preserve current behavior" IS all-`admin`.
 *
 * Mirrors the JSON literal inlined into
 * `packages/database/drizzle/0311_agent_version_permission_policy.sql`, and is what
 * data migration 050 treats as "the flat DDL default that may need correcting".
 *
 * **The SQL literal is kept byte-equivalent to this function, and was corrected
 * in place once** (2026-07-28) after #1351 renamed the rung vocabulary and #1364
 * retired `resourceDefault`. The earlier reasoning for leaving it spelled `"full"`
 * — "already applied, and a fresh database writes it never" — held only for the
 * two environments it was checked against. It is false for any environment that
 * still has `AgentVersion` rows AND has not yet reached 0311: there, the DDL
 * writes a blob `parsePublishedAgentPolicy` cannot read, and every version
 * composes to all-`none` until the worker drains its boot-enqueued
 * data-migrations job. Correcting the file is safe because Drizzle's migrator
 * selects by `folderMillis > lastDbMigration.created_at`, never by hash — an
 * environment that already applied 0311 will not re-run it.
 *
 * Deliberately NOT the fallback for an unreadable policy — that is
 * {@link emptyAgentPolicy}.
 */
export function legacyFullAgentPolicy(): PublishedAgentPermissionPolicy {
  return {
    sourceProfileId: null,
    sourceProfileUpdatedAt: null,
    publishedByUserId: null,
    clamp: [],
    areas: { default: 'admin', overrides: {} },
    definitions: { default: 'admin', overrides: {} },
    resources: {},
  }
}

/**
 * The fail-closed policy used when nothing else can be resolved. Never `'admin'`:
 * an agent whose authorization cannot be determined must be inert, not omnipotent.
 */
export function emptyAgentPolicy(): PublishedAgentPermissionPolicy {
  return {
    sourceProfileId: null,
    sourceProfileUpdatedAt: null,
    publishedByUserId: null,
    clamp: [],
    areas: { default: 'none', overrides: {} },
    definitions: { default: 'none', overrides: {} },
    resources: {},
  }
}

/**
 * Expand a profile's {@link AgentPermissionPolicy} into a total, self-contained
 * {@link PublishedAgentPermissionPolicy} (plan 19 §2.3).
 *
 * "Self-contained" means the result never needs the profile again: defaults are
 * RETAINED (not materialized away) precisely because definitions and resources
 * may be created after publication, and every lookup against the result returns
 * one of the four exact rungs with no `inherit` tier.
 *
 * Known area slugs are materialized into `areas.overrides` so the published rung
 * for a *current* area is explicit in the snapshot and readable in an audit; the
 * retained `areas.default` still answers for an area added by a future deploy.
 */
function expandProfilePolicy(
  agentPolicy: AgentPermissionPolicy,
  profile: { id: string; updatedAt: string | null } | null
): PublishedAgentPermissionPolicy {
  const parsed = parsePublishedAgentPolicy(agentPolicy)

  // Materialized on the area's OWN ladder ({@link clampPermissionToArea}), so the
  // snapshot states the rung the agent actually composes rather than the one the
  // flat vocabulary let the author type.
  const areaOverrides: Record<string, ResourcePermission> = {}
  for (const area of AREA_ORDER) {
    areaOverrides[area] = clampPermissionToArea(area, lookupExactPolicy(parsed.areas, area))
  }

  return {
    sourceProfileId: profile?.id ?? null,
    sourceProfileUpdatedAt: profile?.updatedAt ?? null,
    publishedByUserId: null,
    clamp: [],
    areas: { default: parsed.areas.default, overrides: areaOverrides },
    definitions: parsed.definitions,
    resources: parsed.resources,
  }
}

/**
 * Resolve a DRAFT agent's permission-profile binding into a total policy
 * (plan 19 §1.3 / §2.3) — the input to the publish-time author clamp, and the
 * live policy for draft Chat and draft eval runs.
 *
 *  - An explicit `permissionProfileId` wins, but only when it exists in THIS
 *    org's projection. A foreign or dangling id is refused (never silently
 *    applied), matching the FK's `set null` intent and §1.1's cross-org rule.
 *  - A null binding resolves **by kind**: `internal → agent`, `chat → chat_agent`
 *    ({@link systemProfileForAgentKind}). Nothing is stamped, so editing a system
 *    agent profile reaches every unbound draft immediately.
 *  - A profile with a null `agentPolicy` (a human-only profile mis-bound to an
 *    agent) resolves fail-closed rather than granting the human `baseLevel`.
 *  - A missing system row resolves fail-closed and logs. Unlike the human path
 *    there is no `ROLE_DEFAULTS` to fall back to, and a fail-open agent is the
 *    escalation this whole plan exists to prevent.
 *
 * A published `AgentVersion` NEVER calls this — it carries its own snapshot, so a
 * historical version keeps the rules it was published with even if the source
 * profile is edited or deleted (§0.3).
 */
export function resolveDraftAgentPolicy(input: {
  organizationId: string
  agentId: string
  kind: AgentKind
  permissionProfileId: string | null | undefined
  profiles: readonly CachedPermissionProfile[]
}): PublishedAgentPermissionPolicy {
  const { organizationId, agentId, kind, permissionProfileId, profiles } = input

  if (permissionProfileId) {
    const bound = profiles.find((p) => p.id === permissionProfileId)
    if (bound?.agentPolicy) {
      return expandProfilePolicy(bound.agentPolicy, { id: bound.id, updatedAt: bound.updatedAt })
    }
    logger.warn(
      bound
        ? 'Bound agent permission profile carries no agentPolicy — failing closed'
        : 'Bound agent permission profile not found in org projection — falling back by kind',
      { organizationId, agentId, permissionProfileId }
    )
    if (bound) return emptyAgentPolicy()
  }

  const slug = systemProfileForAgentKind(kind)
  const system = profiles.find((p) => p.slug === slug)
  if (system?.agentPolicy) {
    return expandProfilePolicy(system.agentPolicy, { id: system.id, updatedAt: system.updatedAt })
  }

  logger.warn('System agent permission profile missing — failing closed', {
    organizationId,
    agentId,
    slug,
  })
  return emptyAgentPolicy()
}
