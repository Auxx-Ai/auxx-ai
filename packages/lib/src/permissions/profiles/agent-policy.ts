// packages/lib/src/permissions/profiles/agent-policy.ts

import type {
  AgentAccessLevel,
  AgentKind,
  AgentPermissionPolicy,
  ExactAgentPolicy,
  PublishedAgentPermissionPolicy,
} from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { AREA_ORDER, type Area, Level } from '../capabilities/registry'
import { systemProfileForAgentKind } from './system-profiles'
import type { CachedPermissionProfile } from './types'

const logger = createScopedLogger('agent-permission-policy')

/**
 * Rank of the four exact agent rungs, so `min` is a numeric comparison. Unlike
 * the human `PERMISSION_RANK`, `'none'` here is a real, LOAD-BEARING value — it
 * removes authority rather than merely failing to grant it (plan 19 §0.5), which
 * is exactly why agent policy must never enter the additive, skip-`none`
 * reducers in `compose-user-capabilities.ts`.
 */
export const AGENT_LEVEL_RANK: Record<AgentAccessLevel, number> = {
  none: 0,
  read: 1,
  read_write: 2,
  full: 3,
}

/** Ascending ladder order — `AGENT_LEVELS[rank]`. */
const AGENT_LEVELS: readonly AgentAccessLevel[] = ['none', 'read', 'read_write', 'full']

/** The lower of two exact rungs — the primitive every intersection is built on. */
export function minAgentLevel(a: AgentAccessLevel, b: AgentAccessLevel): AgentAccessLevel {
  return AGENT_LEVEL_RANK[a] <= AGENT_LEVEL_RANK[b] ? a : b
}

/**
 * The label→ladder mapping of plan 19 §2.3, area half:
 *
 * | Published label | Area `Level` |
 * |---|---|
 * | `None`        | `Level.None` |
 * | `Read`        | `Level.Read` |
 * | `Read + Write`| `Level.Edit` |
 * | `Full`        | `Level.Full` |
 */
export function agentLevelToAreaLevel(level: AgentAccessLevel): Level {
  switch (level) {
    case 'none':
      return Level.None
    case 'read':
      return Level.Read
    case 'read_write':
      return Level.Edit
    case 'full':
      return Level.Full
  }
}

/**
 * The label→ladder mapping of plan 19 §2.3, definition/resource half:
 * `None` → no effective permission (`undefined`), `Read` → `view`,
 * `Read + Write` → `edit`, `Full` → `admin`.
 *
 * `undefined` (not `'none'`) is returned for the bottom rung because that is the
 * vocabulary every downstream gate already speaks — `satisfiesPermission` treats
 * a stored `'none'` as a *grant row marker*, not as "denied".
 */
export function agentLevelToPermission(level: AgentAccessLevel): ResourcePermission | undefined {
  switch (level) {
    case 'none':
      return undefined
    case 'read':
      return ResourcePermission.view
    case 'read_write':
      return ResourcePermission.edit
    case 'full':
      return ResourcePermission.admin
  }
}

/** Inverse of {@link agentLevelToAreaLevel} — used by the publish-time clamp. */
export function areaLevelToAgentLevel(level: Level): AgentAccessLevel {
  return AGENT_LEVELS[Math.min(AGENT_LEVELS.length - 1, Math.max(0, level))] ?? 'none'
}

/**
 * Inverse of {@link agentLevelToPermission} — used by the publish-time clamp to
 * express a human's resolved definition/instance permission on the agent ladder.
 */
export function permissionToAgentLevel(
  permission: ResourcePermission | undefined
): AgentAccessLevel {
  switch (permission) {
    case ResourcePermission.admin:
      return 'full'
    case ResourcePermission.edit:
      return 'read_write'
    case ResourcePermission.view:
      return 'read'
    default:
      return 'none'
  }
}

/**
 * Look one key up in an exact policy. There is **no run-time `inherit`**: an
 * override wins, otherwise the keyspace's explicit `default` answers, so every
 * lookup returns exactly one of the four rungs (plan 19 §2.3).
 */
export function lookupExactPolicy(policy: ExactAgentPolicy, key: string): AgentAccessLevel {
  return policy.overrides[key] ?? policy.default
}

/** The published area rung for one capability area. */
export function policyAreaLevel(
  policy: PublishedAgentPermissionPolicy,
  area: Area | string
): AgentAccessLevel {
  return lookupExactPolicy(policy.areas, area)
}

/** The published definition rung for one entity `apiSlug`. */
export function policyDefinitionLevel(
  policy: PublishedAgentPermissionPolicy,
  apiSlug: string
): AgentAccessLevel {
  return lookupExactPolicy(policy.definitions, apiSlug)
}

/**
 * The published rung for one resource instance. A resource TYPE absent from
 * `resources` falls back to `resourceDefault` — that is what makes the snapshot
 * total for resource types (and instances) created after publication.
 */
export function policyResourceLevel(
  policy: PublishedAgentPermissionPolicy,
  resourceType: string,
  instanceId: string
): AgentAccessLevel {
  const forType = policy.resources[resourceType]
  if (!forType) return policy.resourceDefault
  return lookupExactPolicy(forType, instanceId)
}

/** Coerce an arbitrary stored value into the closed rung vocabulary, or `null`. */
export function parseAgentAccessLevel(raw: unknown): AgentAccessLevel | null {
  return typeof raw === 'string' && raw in AGENT_LEVEL_RANK ? (raw as AgentAccessLevel) : null
}

/**
 * Defensively coerce a stored exact-policy jsonb into the trusted shape. An
 * unusable `default` falls back to `fallbackDefault`; override entries outside
 * the closed vocabulary are DROPPED (they then read as the default) rather than
 * guessed at.
 */
function parseExactPolicy(raw: unknown, fallbackDefault: AgentAccessLevel): ExactAgentPolicy {
  const source = (raw ?? {}) as { default?: unknown; overrides?: unknown }
  const parsedDefault = parseAgentAccessLevel(source.default) ?? fallbackDefault

  const overrides: Record<string, AgentAccessLevel> = {}
  if (source.overrides && typeof source.overrides === 'object') {
    for (const [key, value] of Object.entries(source.overrides as Record<string, unknown>)) {
      const level = parseAgentAccessLevel(value)
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
 * and the safe direction for an unreadable policy is `'none'`, not `'full'`.
 *
 * @param raw - The stored jsonb value.
 * @param fallbackDefault - Rung to use for an unreadable `default`. Defaults to
 *   `'none'` (fail closed). Pass `'full'` only where preserving legacy behavior
 *   is the explicit intent.
 */
export function parsePublishedAgentPolicy(
  raw: unknown,
  fallbackDefault: AgentAccessLevel = 'none'
): PublishedAgentPermissionPolicy {
  const source = (raw ?? {}) as Partial<PublishedAgentPermissionPolicy> & {
    resources?: unknown
    clamp?: unknown
  }

  const resourceDefault = parseAgentAccessLevel(source.resourceDefault) ?? fallbackDefault
  const resources: Record<string, ExactAgentPolicy> = {}
  if (source.resources && typeof source.resources === 'object') {
    for (const [type, value] of Object.entries(source.resources as Record<string, unknown>)) {
      resources[type] = parseExactPolicy(value, resourceDefault)
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
    resourceDefault,
    resources,
  }
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
  resourceDefault: AgentAccessLevel
  resources: Partial<Record<string, ExactAgentPolicy>>
} {
  return {
    areas: policy.areas,
    definitions: policy.definitions,
    resourceDefault: policy.resourceDefault,
    resources: policy.resources,
  }
}

/**
 * The all-`full` policy that preserves today's dormant agent posture — every agent
 * currently composes `Level.Full` on every area with no explicit grant row
 * (plan 14 §0.3), so "preserve current behavior" IS all-`full`.
 *
 * Mirrors the JSON literal inlined into
 * `packages/database/drizzle/0311_agent_version_permission_policy.sql`, and is what
 * data migration 042 treats as "the flat DDL default that may need correcting".
 * Deliberately NOT the fallback for an unreadable policy — that is
 * {@link emptyAgentPolicy}.
 */
export function legacyFullAgentPolicy(): PublishedAgentPermissionPolicy {
  return {
    sourceProfileId: null,
    sourceProfileUpdatedAt: null,
    publishedByUserId: null,
    clamp: [],
    areas: { default: 'full', overrides: {} },
    definitions: { default: 'full', overrides: {} },
    resourceDefault: 'full',
    resources: {},
  }
}

/**
 * The fail-closed policy used when nothing else can be resolved. Never `'full'`:
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
    resourceDefault: 'none',
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

  const areaOverrides: Record<string, AgentAccessLevel> = {}
  for (const area of AREA_ORDER) {
    areaOverrides[area] = lookupExactPolicy(parsed.areas, area)
  }

  return {
    sourceProfileId: profile?.id ?? null,
    sourceProfileUpdatedAt: profile?.updatedAt ?? null,
    publishedByUserId: null,
    clamp: [],
    areas: { default: parsed.areas.default, overrides: areaOverrides },
    definitions: parsed.definitions,
    resourceDefault: parsed.resourceDefault,
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
