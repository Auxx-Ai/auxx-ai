// packages/lib/src/data-migrations/migrations/054-agent-policy-vocabulary.ts

import type { Database, PublishedAgentPermissionPolicy } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { hashAgentConfig } from '../../agents/agent-config-snapshot'
import { onCacheEvent } from '../../cache'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-054')

const CHUNK = 500

/**
 * The old agent-policy rung spelling → the `ResourcePermission` spelling
 * (plan 26 §2.6). `'none'` is unchanged in both, and is deliberately absent here:
 * a value already in the new vocabulary must pass through untouched, which is
 * what makes {@link migrateRung} idempotent.
 */
const RUNG_RENAMES: Readonly<Record<string, string>> = {
  read: 'view',
  read_write: 'edit',
  full: 'admin',
}

/**
 * Rewrite one stored rung. Anything already in the new vocabulary — or outside
 * both — is returned verbatim, so a second pass is a no-op and an unrecognized
 * value is left for `parsePublishedAgentPolicy` to drop at read time rather than
 * being guessed at here.
 */
function migrateRung(raw: unknown): unknown {
  return typeof raw === 'string' ? (RUNG_RENAMES[raw] ?? raw) : raw
}

/** Rewrite one `{ default, overrides }` keyspace in place-free fashion. */
function migrateExact(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const source = raw as { default?: unknown; overrides?: unknown }
  const overrides: Record<string, unknown> = {}
  if (source.overrides && typeof source.overrides === 'object') {
    for (const [key, value] of Object.entries(source.overrides as Record<string, unknown>)) {
      overrides[key] = migrateRung(value)
    }
  }
  return { ...source, default: migrateRung(source.default), overrides }
}

/**
 * Rewrite every rung in one stored agent policy — the authored
 * `PermissionProfile.agentPolicy` shape and the published
 * `AgentVersion.permissionPolicy` shape at once, since the published one is the
 * authored one plus audit metadata.
 *
 * Exported so the rename is testable as a pure function, independent of the DB
 * plumbing around it.
 */
export function migrateAgentPolicyVocabulary<T>(raw: T): T {
  if (!raw || typeof raw !== 'object') return raw
  const source = raw as Record<string, unknown>

  const resources: Record<string, unknown> = {}
  if (source.resources && typeof source.resources === 'object') {
    for (const [type, value] of Object.entries(source.resources as Record<string, unknown>)) {
      resources[type] = migrateExact(value)
    }
  }

  // The clamp trail records `from`/`to` rungs. It is audit metadata, excluded
  // from `authorizationOnlyPolicy` and therefore from `configHash` — but it is
  // RENDERED (`clampSentence`), so leaving it in the old spelling would print a
  // rung name the UI can no longer look up.
  const clamp = Array.isArray(source.clamp)
    ? source.clamp.map((entry) =>
        entry && typeof entry === 'object'
          ? {
              ...(entry as Record<string, unknown>),
              from: migrateRung((entry as Record<string, unknown>).from),
              to: migrateRung((entry as Record<string, unknown>).to),
            }
          : entry
      )
    : source.clamp

  return {
    ...source,
    ...(source.clamp === undefined ? {} : { clamp }),
    ...(source.areas === undefined ? {} : { areas: migrateExact(source.areas) }),
    ...(source.definitions === undefined ? {} : { definitions: migrateExact(source.definitions) }),
    ...(source.resourceDefault === undefined
      ? {}
      : { resourceDefault: migrateRung(source.resourceDefault) }),
    ...(source.resources === undefined ? {} : { resources }),
  } as T
}

/** Whether a policy blob still holds a value in the retired vocabulary. */
function needsMigration(raw: unknown): boolean {
  return JSON.stringify(raw) !== JSON.stringify(migrateAgentPolicyVocabulary(raw))
}

/**
 * Rename the agent-policy rung vocabulary in storage: `read → view`,
 * `read_write → edit`, `full → admin` (plan 26 §2.6, "Phase 2").
 *
 * **What this actually collapses.** The agent policy and every `ResourceAccess`
 * row describe the same four-rung ladder, but agent policy shipped with its own
 * `AgentAccessLevel` spelling. That meant a bijection at every boundary between
 * the two — `agentLevelToPermission`, `permissionToAgentLevel`, and their client
 * mirrors — each of which is a place the two ladders could quietly disagree.
 * After this migration `AgentAccessLevel` is gone and both sides store
 * `ResourcePermission`, so those converters are deleted rather than re-threaded.
 *
 * **This changes NO authority.** The rename is value-for-value on a total
 * bijection: rung *n* before is rung *n* after, in every keyspace. The
 * composed-capability snapshot test
 * (`permissions/profiles/agent-policy-vocabulary.test.ts`) pins that claim
 * against a baseline captured from the pre-rename code.
 *
 * **Two columns, and a hash.**
 *  - `PermissionProfile.agentPolicy` — the authored policy.
 *  - `AgentVersion.permissionPolicy` — every published snapshot, including
 *    historical versions. A historical version keeps the rules it was published
 *    with (plan 19 §0.3); those rules are unchanged, only their spelling is.
 *  - `AgentVersion.configHash` covers `authorizationOnlyPolicy(policy)`, whose
 *    stable-stringified content is exactly what this rewrites. Left alone, every
 *    row's stored hash would be stale and the first publish after deploy would
 *    compare a new hash against an old one and mint a pointless version — the
 *    same trap migration 050 documents. So it is recomputed for every row this
 *    migration touches.
 *
 * **Idempotent.** {@link migrateRung} maps the new vocabulary to itself, so a
 * second run computes byte-identical values and writes nothing. Rows already in
 * the new spelling are skipped before any update is issued.
 *
 * **Unlike migration 050, `publishedByUserId` is NOT a skip condition.** 050 was
 * correcting a flat DDL default and had to leave authoritative publish-path
 * snapshots alone; this is a spelling change that every row needs, including the
 * ones the publish path wrote.
 */
export const migration054AgentPolicyVocabulary: DataMigrationDef = {
  id: '054-agent-policy-vocabulary',
  description:
    'Rename the agent policy rung vocabulary (read→view, read_write→edit, full→admin) in PermissionProfile.agentPolicy and AgentVersion.permissionPolicy, recomputing configHash',
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
        .set({ agentPolicy: migrateAgentPolicyVocabulary(profile.agentPolicy) })
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
          ? migrateAgentPolicyVocabulary(version.permissionPolicy as PublishedAgentPermissionPolicy)
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

    // The org `profiles` projection carries `agentPolicy`; the `agents` cache
    // projects the active version's policy + configHash. Both go stale here.
    // `broadcastUserKeys` is deliberately NOT set: `agentPolicy` is agent-only
    // and never enters human composition, so no member's `userCapabilities` blob
    // changed — only the two org projections did.
    for (const orgId of affectedOrgIds) {
      await onCacheEvent('permission-profile.changed', { orgId })
      await onCacheEvent('agent.updated', { orgId })
    }

    logger.info('Renamed agent policy rung vocabulary', {
      profiles: profiles.length,
      profilesRewritten,
      versions: versions.length,
      versionsRewritten,
      hashesRecomputed,
      orgsInvalidated: affectedOrgIds.size,
    })
  },
}
