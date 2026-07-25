// packages/lib/src/data-migrations/migrations/050-agent-version-permission-policy.ts

import type { Database, PublishedAgentPermissionPolicy } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { hashAgentConfig } from '../../agents/agent-config-snapshot'
import { onCacheEvent } from '../../cache'
import {
  AREA_ORDER,
  type Area,
  Level,
  parseAreaLevels,
} from '../../permissions/capabilities/registry'
import {
  areaLevelToAgentLevel,
  legacyFullAgentPolicy,
} from '../../permissions/profiles/agent-policy'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-042')

const CHUNK = 500

/**
 * Finish what the DDL started for `AgentVersion.permissionPolicy` (plan 19 §5.2
 * step 4).
 *
 * **What the Drizzle migration already did, and why this is small.**
 * `0311_agent_version_permission_policy.sql` adds the column nullable, backfills
 * every existing row with the all-`full` policy inline, then sets `NOT NULL` — one
 * self-sufficient file, no dependency on this migration having run. That flat
 * default is EXACT for the overwhelming majority of rows, because every agent
 * composes `Level.Full` on every area with no explicit grant row today (plan 14
 * §0.3, enforcement dormant at the all-Full default). So this migration exists
 * only for the two things SQL could not do:
 *
 * 1. **Honor per-agent AGENT-grantee `PermissionGrant` rows.** The shipped
 *    `composeAgentLevels` branch read `userLevels[area] ?? Level.Full`, so an org
 *    that DID restrict an agent through the doc-14 Permissions tab has real area
 *    levels on a `granteeType: 'user'` row keyed by the agent's synthetic
 *    `User.id`. The flat SQL default would silently WIDEN those agents back to
 *    all-`full` — the one way this migration could change behavior rather than
 *    preserve it. Any such row is translated onto the exact ladder and written to
 *    every version of that agent.
 * 2. **Recompute `configHash`.** The hash now covers the policy's authorization
 *    content, so every pre-existing row's stored hash is stale. Left stale, the
 *    first publish after deploy would compare a new hash against an old one and
 *    mint a pointless version (or, worse, a no-op check would pass for the wrong
 *    reason). Recomputed for every row, including the ones the SQL default already
 *    got right.
 *
 * **Definitions and instances are deliberately NOT reconstructed.** Under the old
 * model an agent's per-def authority came from `ResourceAccess` rows composed
 * most-specific-wins, and a def with no row at all was unrestricted — i.e. `full`,
 * which is what the flat default already says. A def the org had RESTRICTED
 * workspace-wide was denied to the agent unless granted, but that restriction
 * still applies today through the human-side `restrictedEntityDefIds` machinery on
 * every other principal, and re-deriving it into a per-agent snapshot would be
 * guessing at a model that is being replaced. The correct posture is authored on
 * the profile and takes effect on the next publish; §5.2 step 4 asks for "current
 * behavior as the migration default", not a reconstruction of the old algebra.
 *
 * **Idempotent and re-runnable.** Every write is derived purely from the row's own
 * current content plus the agent's grant row, so a second run recomputes the same
 * values and changes nothing. It never overwrites a policy that carries a
 * `publishedByUserId` — that marks a snapshot written by the NEW publish path,
 * which is authoritative and must not be reverted to a migration default.
 */
export const migration050AgentVersionPermissionPolicy: DataMigrationDef = {
  id: '050-agent-version-permission-policy',
  description:
    'Honor legacy per-agent area grants in AgentVersion.permissionPolicy and recompute configHash to include the snapshot',
  async run(db: Database): Promise<void> {
    const versions = await db
      .select({
        id: schema.AgentVersion.id,
        organizationId: schema.AgentVersion.organizationId,
        agentId: schema.AgentVersion.agentId,
        prompt: schema.AgentVersion.prompt,
        toolsets: schema.AgentVersion.toolsets,
        knowledge: schema.AgentVersion.knowledge,
        appAccounts: schema.AgentVersion.appAccounts,
        toolRestrictions: schema.AgentVersion.toolRestrictions,
        modelId: schema.AgentVersion.modelId,
        permissionPolicy: schema.AgentVersion.permissionPolicy,
        configHash: schema.AgentVersion.configHash,
        agentUserId: schema.Agent.userId,
      })
      .from(schema.AgentVersion)
      .innerJoin(schema.Agent, eq(schema.Agent.id, schema.AgentVersion.agentId))

    if (versions.length === 0) {
      logger.info('No agent versions to reconcile')
      return
    }

    // One query for every legacy AGENT-grantee area grant, then an in-memory
    // lookup per version — O(1) queries rather than one per agent.
    const legacyAreaLevels = await loadLegacyAgentAreaLevels(db)

    let policiesCorrected = 0
    let hashesRecomputed = 0
    let skippedAlreadyPublished = 0
    const affectedOrgIds = new Set<string>()

    for (let i = 0; i < versions.length; i += CHUNK) {
      for (const version of versions.slice(i, i + CHUNK)) {
        const grantLevels = version.agentUserId
          ? legacyAreaLevels.get(version.agentUserId)
          : undefined

        let policy = version.permissionPolicy
        let policyChanged = false

        // A snapshot written by the new publish path records its publisher. Never
        // overwrite one — it is the authoritative, author-clamped result.
        if (policy?.publishedByUserId) {
          skippedAlreadyPublished += 1
        } else if (grantLevels) {
          const corrected = legacyPolicyFromAreaLevels(grantLevels)
          if (JSON.stringify(corrected.areas) !== JSON.stringify(policy?.areas)) {
            policy = corrected
            policyChanged = true
            policiesCorrected += 1
          }
        }

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

        if (hashChanged) hashesRecomputed += 1
        affectedOrgIds.add(version.organizationId)
      }
    }

    // The `agents` cache projects the active version's policy + configHash.
    for (const orgId of affectedOrgIds) {
      await onCacheEvent('agent.updated', { orgId })
    }

    logger.info('Reconciled agent version permission policies', {
      versions: versions.length,
      policiesCorrected,
      hashesRecomputed,
      skippedAlreadyPublished,
      legacyAgentGrants: legacyAreaLevels.size,
      orgsInvalidated: affectedOrgIds.size,
    })
  },
}

/**
 * Every legacy per-agent area grant, keyed by the agent's synthetic `User.id`.
 *
 * These are `granteeType: 'user'` rows whose grantee is a `userType: 'AGENT'`
 * User — the storage the doc-14 agent Permissions tab wrote. Joining through
 * `Agent.userId` (rather than `User.userType`) also guarantees the row really
 * belongs to an agent in the same org.
 */
async function loadLegacyAgentAreaLevels(
  db: Database
): Promise<Map<string, Partial<Record<Area, Level>>>> {
  const rows = await db
    .select({
      granteeId: schema.PermissionGrant.granteeId,
      levels: schema.PermissionGrant.levels,
    })
    .from(schema.PermissionGrant)
    .innerJoin(
      schema.Agent,
      and(
        eq(schema.Agent.userId, schema.PermissionGrant.granteeId),
        eq(schema.Agent.organizationId, schema.PermissionGrant.organizationId)
      )
    )
    .where(eq(schema.PermissionGrant.granteeType, 'user'))

  const out = new Map<string, Partial<Record<Area, Level>>>()
  for (const row of rows) {
    const levels = parseAreaLevels(row.levels)
    if (Object.keys(levels).length > 0) out.set(row.granteeId, levels)
  }
  return out
}

/**
 * Translate a legacy sparse area-level map into an exact published policy,
 * reproducing the shipped SET branch exactly: `level = userLevels[area] ?? Full`.
 *
 * Definitions and resources keep the all-`full` legacy default — see the migration
 * JSDoc for why they are not reconstructed.
 */
function legacyPolicyFromAreaLevels(
  levels: Partial<Record<Area, Level>>
): PublishedAgentPermissionPolicy {
  const base = legacyFullAgentPolicy()
  const overrides: Record<string, string> = {}
  for (const area of AREA_ORDER) {
    overrides[area] = areaLevelToAgentLevel(levels[area] ?? Level.Full)
  }
  return {
    ...base,
    areas: {
      default: 'full',
      overrides: overrides as PublishedAgentPermissionPolicy['areas']['overrides'],
    },
  }
}
