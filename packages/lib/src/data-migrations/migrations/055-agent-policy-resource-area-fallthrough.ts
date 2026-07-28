// packages/lib/src/data-migrations/migrations/055-agent-policy-resource-area-fallthrough.ts

import type { Database, PublishedAgentPermissionPolicy } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { hashAgentConfig } from '../../agents/agent-config-snapshot'
import { onCacheEvent } from '../../cache'
import { PERMISSION_RANK } from '../../permissions/capabilities/compose-user-capabilities'
import {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
} from '../../permissions/capabilities/instance-access'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-055')

const CHUNK = 500

/** Read one keyspace's rung for `key`, or its `default` when unnamed. */
function lookup(raw: unknown, key: string): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as { default?: unknown; overrides?: Record<string, unknown> }
  const override = source.overrides?.[key]
  const value = typeof override === 'string' ? override : source.default
  return typeof value === 'string' ? value : undefined
}

/** `true` when `a` sits strictly below `b` on the four-rung ladder. */
function isBelow(a: string, b: string): boolean {
  const rankA = PERMISSION_RANK[a as ResourcePermission]
  const rankB = PERMISSION_RANK[b as ResourcePermission]
  if (rankA === undefined || rankB === undefined) return false
  return rankA < rankB
}

/**
 * Drop `resourceDefault` from one stored agent policy, materializing it as an
 * explicit per-type entry wherever it was actually load-bearing.
 *
 * **The whole point is that authority must not move.** The old read was
 * `min(resources[type]?.default ?? resourceDefault, areaRung)`; the new one is
 * `min(resources[type]?.default ?? areaRung, areaRung)`. Those agree for every
 * type that already HAS an entry, and for every type where `resourceDefault` was
 * at or above its area rung (the `min` picked the area either way). They differ
 * only where an absent type had `resourceDefault` *below* its area — an admin who
 * deliberately held resources under the feature gate — so exactly those types get
 * the old rung written out as a rule of their own.
 *
 * Types are only materialized when they change something, so the four seeded
 * presets and any policy that left `resourceDefault` permissive come through with
 * an unchanged (just shorter) blob rather than five new entries of noise.
 *
 * Exported so the equivalence is testable as a pure function.
 */
export function dropResourceDefault<T>(raw: T): T {
  if (!raw || typeof raw !== 'object') return raw
  const source = raw as Record<string, unknown>
  if (source.resourceDefault === undefined) return raw

  const resourceDefault = source.resourceDefault
  const existing = (
    source.resources && typeof source.resources === 'object' ? source.resources : {}
  ) as Record<string, unknown>
  const resources: Record<string, unknown> = { ...existing }

  if (typeof resourceDefault === 'string') {
    for (const key of INSTANCE_ACCESS_KEYS) {
      if (resources[key] !== undefined) continue
      const areaRung = lookup(source.areas, INSTANCE_ACCESS_RESOURCES[key].area)
      // No readable area rung → the new fall-through is whatever the parser
      // makes of it; pin the old answer explicitly rather than gamble.
      if (areaRung === undefined || isBelow(resourceDefault, areaRung)) {
        resources[key] = { default: resourceDefault, overrides: {} }
      }
    }
  }

  const { resourceDefault: _dropped, ...rest } = source
  return { ...rest, resources } as T
}

/** Whether a policy blob still carries the retired field. */
function needsMigration(raw: unknown): boolean {
  return JSON.stringify(raw) !== JSON.stringify(dropResourceDefault(raw))
}

/**
 * Retire `AgentPermissionPolicy.resourceDefault` — a resource type with no rule
 * of its own now falls through to its own L2 area rung.
 *
 * **Why the field went.** It answered "what does a resource type with no rule
 * resolve to?" one level above the area gate its answer was then intersected
 * with, so the profile editor carried two blanket dropdowns side by side —
 * `Unset areas fall through to` and `New resource types fall through to` — whose
 * difference nobody could state, and an `All datasets` child row could read
 * *"Default · None"* underneath a `Datasets: Read` parent. The area rung was
 * already the intersecting term and is already authored one row above, so it is
 * the fall-through now. This is the human model verbatim:
 * `INSTANCE_ACCESS_RESOURCES` declares that for a `baselineAtCreate: false`
 * resource an absent instance row resolves to the base L2 area level.
 *
 * **This changes no authority** — see {@link dropResourceDefault} for why, and
 * for the one case that is materialized rather than dropped.
 *
 * **Two columns, and a hash**, the same three surfaces migration 054 touched:
 *  - `PermissionProfile.agentPolicy` — the authored policy.
 *  - `AgentVersion.permissionPolicy` — every published snapshot, historical ones
 *    included. Publishing already materializes every registered type, so most
 *    snapshots lose the field and nothing else; system publishes (no clamp) are
 *    the sparse ones the materialization branch exists for.
 *  - `AgentVersion.configHash` covers `authorizationOnlyPolicy(policy)`, which no
 *    longer includes `resourceDefault`. Left alone, every stored hash would be
 *    stale and the first publish after deploy would mint a pointless version —
 *    the trap migrations 050 and 054 both document. Recomputed for every row.
 *
 * **Idempotent.** A blob with no `resourceDefault` is returned verbatim, so a
 * second run writes nothing.
 */
export const migration055AgentPolicyResourceAreaFallthrough: DataMigrationDef = {
  id: '055-agent-policy-resource-area-fallthrough',
  description:
    'Retire AgentPermissionPolicy.resourceDefault in favour of the per-type L2 area fall-through, materializing it where it sat below its area, and recomputing configHash',
  async run(db: Database): Promise<void> {
    const affectedOrgIds = new Set<string>()

    // ── PermissionProfile.agentPolicy ────────────────────────────────────
    const profiles = await db
      .select({
        id: schema.PermissionProfile.id,
        organizationId: schema.PermissionProfile.organizationId,
        agentPolicy: schema.PermissionProfile.agentPolicy,
      })
      .from(schema.PermissionProfile)

    let profilesRewritten = 0
    for (const profile of profiles) {
      if (!profile.agentPolicy || !needsMigration(profile.agentPolicy)) continue
      await db
        .update(schema.PermissionProfile)
        .set({ agentPolicy: dropResourceDefault(profile.agentPolicy) })
        .where(eq(schema.PermissionProfile.id, profile.id))
      profilesRewritten += 1
      affectedOrgIds.add(profile.organizationId)
    }

    // ── AgentVersion.permissionPolicy (+ configHash) ─────────────────────
    const versions = await db
      .select({
        id: schema.AgentVersion.id,
        organizationId: schema.AgentVersion.organizationId,
        prompt: schema.AgentVersion.prompt,
        toolsets: schema.AgentVersion.toolsets,
        knowledge: schema.AgentVersion.knowledge,
        appAccounts: schema.AgentVersion.appAccounts,
        toolRestrictions: schema.AgentVersion.toolRestrictions,
        modelId: schema.AgentVersion.modelId,
        permissionPolicy: schema.AgentVersion.permissionPolicy,
        configHash: schema.AgentVersion.configHash,
      })
      .from(schema.AgentVersion)

    let versionsRewritten = 0
    let hashesRecomputed = 0

    for (let i = 0; i < versions.length; i += CHUNK) {
      for (const version of versions.slice(i, i + CHUNK)) {
        const policyChanged = needsMigration(version.permissionPolicy)
        const policy = policyChanged
          ? dropResourceDefault(version.permissionPolicy as PublishedAgentPermissionPolicy)
          : version.permissionPolicy

        const nextHash = hashAgentConfig({ ...version, permissionPolicy: policy })
        const hashChanged = nextHash !== version.configHash
        if (!policyChanged && !hashChanged) continue

        await db
          .update(schema.AgentVersion)
          .set({
            ...(policyChanged ? { permissionPolicy: policy } : {}),
            configHash: nextHash,
          })
          .where(eq(schema.AgentVersion.id, version.id))

        if (policyChanged) versionsRewritten += 1
        if (hashChanged) hashesRecomputed += 1
        affectedOrgIds.add(version.organizationId)
      }
    }

    // Same two org projections migration 054 invalidated: `profiles` carries
    // `agentPolicy`, `agents` carries the active version's policy + configHash.
    // No `broadcastUserKeys` — agent policy never enters human composition, so no
    // member's `userCapabilities` blob changed.
    for (const orgId of affectedOrgIds) {
      await onCacheEvent('permission-profile.changed', { orgId })
      await onCacheEvent('agent.updated', { orgId })
    }

    logger.info('Retired agent policy resourceDefault', {
      profiles: profiles.length,
      profilesRewritten,
      versions: versions.length,
      versionsRewritten,
      hashesRecomputed,
      orgsInvalidated: affectedOrgIds.size,
    })
  },
}
