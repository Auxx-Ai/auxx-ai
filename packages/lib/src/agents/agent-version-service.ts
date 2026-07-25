// packages/lib/src/agents/agent-version-service.ts

import type { AgentPolicyClampEntry } from '@auxx/database'
import { type AgentVersionEntity, database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, desc, eq, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { onCacheEvent } from '../cache'
import { hashAgentConfig, snapshotAgentConfig } from './agent-config-snapshot'
import { resolvePublishPolicy } from './agent-permission-policy'
import { reconcileAgentProcedureMentions } from './procedures/mention-reconcile'

/**
 * Draft/publish lifecycle for an agent's behavior config — the agent analogue of
 * `publishProcedure`/`revertProcedure` (`procedures/queries.ts`), minus the draft
 * version row: the {@link schema.Agent} row IS the draft, and publishing snapshots
 * its six versioned fields into an immutable numbered {@link schema.AgentVersion}.
 * Functional service (no model classes), `neverthrow` results.
 *
 * See plans/agents/agent-versions/build-plan.md §2.
 */

const logger = createScopedLogger('agent-version-service')

export type { AgentVersionEntity }

/** Newest-first version-history projection (meta only — no behavior payload). */
export interface AgentVersionMeta {
  id: string
  versionNumber: number
  label: string | null
  editorId: string | null
  editorName: string | null
  createdAt: Date
  configHash: string
}

interface PublishAgentTxInput {
  organizationId: string
  agentId: string
  editorId?: string | null
  label?: string | null
  /**
   * The human whose own authority bounds this publish (plan 19 §2.4a). REQUIRED,
   * not optional: `null` means "system publish, apply no clamp", and forcing every
   * caller to state that explicitly is what keeps an omitted publisher from
   * becoming a silent escalation path.
   */
  publishedByUserId: string | null
}

/** A publish outcome plus what the author clamp reduced, for the caller to surface. */
export interface PublishAgentResult {
  version: AgentVersionEntity
  /**
   * Reductions the §2.4a author clamp applied. Non-empty means the published
   * agent has LESS authority than its profile asked for, because the publisher
   * does not hold it — the UI must say so ("Deals reduced from Full to Read")
   * rather than downgrade silently. `[]` on a no-op republish and whenever the
   * publisher held everything (the OWNER/ADMIN case).
   */
  reductions: AgentPolicyClampEntry[]
}

/**
 * Snapshot the Agent row's current behavior config **and its resolved permission
 * policy** into a new numbered `AgentVersion` and repoint `activeVersionId`, on a
 * caller-provided transaction so it composes with `completeAgentSetup`. Rejects
 * pre-setup agents. Throws on failure so the outer transaction rolls back.
 *
 * The policy is resolved from the draft `Agent.permissionProfileId` and then
 * clamped by `publishedByUserId`'s own effective capabilities (§2.4a) BEFORE the
 * no-op check, because the clamped policy is part of `configHash`: if the profile
 * changed, or the publisher's authority did, this is genuinely a new version.
 *
 * No-op republish: if the active version's `configHash` already equals the freshly
 * computed one, just clear the dirty flag and return the active version — the
 * existing snapshot's `publishedByUserId` is deliberately left alone, since
 * nothing about the authority changed.
 */
export async function publishAgentTx(
  tx: Transaction,
  input: PublishAgentTxInput
): Promise<PublishAgentResult> {
  const { organizationId, agentId, editorId, label, publishedByUserId } = input
  const now = new Date()

  const agent = await tx.query.Agent.findFirst({
    where: and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)),
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  if (!agent.setupCompletedAt) throw new Error('AGENT_NOT_SETUP')

  const { policy: permissionPolicy, reductions } = await resolvePublishPolicy({
    organizationId,
    agent: {
      id: agent.id,
      kind: agent.kind,
      permissionProfileId: agent.permissionProfileId,
    },
    publishedByUserId,
  })

  const snapshot = snapshotAgentConfig(agent)
  const configHash = hashAgentConfig({ ...agent, permissionPolicy })

  // No-op republish: the row already matches the live version — drop the dirty
  // flag (if set) and return the active version unchanged.
  if (agent.activeVersionId) {
    const active = await tx.query.AgentVersion.findFirst({
      where: eq(schema.AgentVersion.id, agent.activeVersionId),
    })
    if (active && active.configHash === configHash) {
      if (agent.hasUnpublishedChanges) {
        await tx
          .update(schema.Agent)
          .set({ hasUnpublishedChanges: false, updatedAt: now })
          .where(eq(schema.Agent.id, agentId))
      }
      return { version: active, reductions: [] }
    }
  }

  const [{ next } = { next: 1 }] = await tx
    .select({ next: sql<number>`COALESCE(MAX(${schema.AgentVersion.versionNumber}), 0) + 1` })
    .from(schema.AgentVersion)
    .where(eq(schema.AgentVersion.agentId, agentId))

  const [published] = await tx
    .insert(schema.AgentVersion)
    .values({
      organizationId,
      agentId,
      versionNumber: next ?? 1,
      label: label ?? null,
      prompt: snapshot.prompt,
      toolsets: snapshot.toolsets,
      knowledge: snapshot.knowledge,
      appAccounts: snapshot.appAccounts,
      toolRestrictions: snapshot.toolRestrictions,
      modelId: snapshot.modelId,
      permissionPolicy,
      configHash,
      editorId: editorId ?? null,
    })
    .returning()
  if (!published) throw new Error('Failed to insert AgentVersion')

  await tx
    .update(schema.Agent)
    .set({ activeVersionId: published.id, hasUnpublishedChanges: false, updatedAt: now })
    .where(eq(schema.Agent.id, agentId))

  return { version: published, reductions }
}

/**
 * Publish the agent's draft as a new version (or no-op republish). Human-only —
 * there is no Kopilot publish tool. Post-tx busts the `agents` cache so the
 * active-version view refreshes.
 */
export async function publishAgent(input: {
  organizationId: string
  agentId: string
  editorId?: string | null
  label?: string | null
  /** See {@link PublishAgentTxInput.publishedByUserId} — `null` = system publish. */
  publishedByUserId: string | null
}) {
  const result = await fromDatabase(
    database.transaction((tx) => publishAgentTx(tx, input)),
    'publish-agent'
  )
  if (result.isErr()) return err(result.error)
  await fireAgentCacheEvent(input.organizationId, input.agentId)
  return ok(result.value)
}

/**
 * Restore-as-draft (article semantic): copy a published version's behavior fields
 * back onto the Agent row and mark dirty by hash-compare against the **active**
 * version (restoring config equal to active ≙ discard, not dirty).
 * `activeVersionId` is NOT touched — nothing goes live until publish. Post-tx
 * re-runs the procedure-mention reconciler: attached procedure docs may have
 * changed since this version, so the derived rows must re-derive against today's
 * procedures.
 *
 * **Permissions restore too** (plan 19 §14), and the mechanism is worth stating
 * because the two sides of the version boundary hold different things: an
 * `AgentVersion` holds a resolved *policy*, while the draft `Agent` row holds a
 * profile *binding* (§0.3 — "bind, do not stamp"). Restore therefore repoints
 * `Agent.permissionProfileId` at the profile the target version was cut from
 * (`permissionPolicy.sourceProfileId`), so publishing the restored draft
 * reproduces that version's policy. Three deliberate consequences:
 *
 * - The target version's own snapshot is untouched and remains exactly executable
 *   if it is ever made active again — a historical version always keeps the rules
 *   it was published with.
 * - `sourceProfileId` is audit text, not an FK (§8.4). A version cut from a
 *   since-deleted profile, or from no profile at all, leaves the binding alone and
 *   logs; the next publish then resolves by kind (§0.24), which preserves published
 *   behavior instead of silently changing it.
 * - Because `configHash` covers the policy, restoring a version whose authority
 *   differs from the active one correctly marks the draft dirty.
 */
export async function restoreAgentVersion(input: {
  organizationId: string
  agentId: string
  toVersionId: string
}) {
  const { organizationId, agentId, toVersionId } = input
  const now = new Date()

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const agent = await tx.query.Agent.findFirst({
        where: and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)),
        columns: { activeVersionId: true, permissionProfileId: true },
      })
      if (!agent) throw new Error('AGENT_NOT_FOUND')

      const target = await tx.query.AgentVersion.findFirst({
        where: and(
          eq(schema.AgentVersion.id, toVersionId),
          eq(schema.AgentVersion.agentId, agentId)
        ),
      })
      if (!target) throw new Error('TARGET_VERSION_NOT_FOUND')

      // Dirty iff the restored config differs from the live one.
      let dirty = true
      if (agent.activeVersionId) {
        const active = await tx.query.AgentVersion.findFirst({
          where: eq(schema.AgentVersion.id, agent.activeVersionId),
          columns: { configHash: true },
        })
        dirty = !active || active.configHash !== target.configHash
      }

      // Restore the version's profile binding when that profile still exists in
      // THIS org (the cross-org / dangling check of §1.1). Verified inside the txn
      // rather than off the cache, because the binding is a write.
      const restoredProfileId = target.permissionPolicy?.sourceProfileId ?? null
      let permissionProfileId = agent.permissionProfileId
      if (restoredProfileId) {
        const profile = await tx.query.PermissionProfile.findFirst({
          where: and(
            eq(schema.PermissionProfile.id, restoredProfileId),
            eq(schema.PermissionProfile.organizationId, organizationId)
          ),
          columns: { id: true },
        })
        if (profile) {
          permissionProfileId = profile.id
        } else {
          logger.warn(
            'Restored version references a permission profile that no longer exists — leaving the draft binding unchanged',
            { organizationId, agentId, toVersionId, sourceProfileId: restoredProfileId }
          )
        }
      }

      await tx
        .update(schema.Agent)
        .set({
          prompt: target.prompt,
          toolsets: target.toolsets,
          knowledge: target.knowledge,
          appAccounts: target.appAccounts,
          toolRestrictions: target.toolRestrictions,
          modelId: target.modelId,
          permissionProfileId,
          hasUnpublishedChanges: dirty,
          updatedAt: now,
        })
        .where(eq(schema.Agent.id, agentId))
    }),
    'restore-agent-version'
  )
  if (result.isErr()) return err(result.error)

  await fireAgentCacheEvent(organizationId, agentId)
  // Restored toolsets/knowledge carry that version's mention rows; re-derive the
  // `'procedure'` tag against today's attached procedures.
  try {
    await reconcileAgentProcedureMentions(organizationId, agentId)
  } catch (error) {
    logger.warn('Failed to reconcile procedure mentions after restore', {
      organizationId,
      agentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return ok(undefined)
}

/**
 * Discard draft edits — `restoreAgentVersion(activeVersionId)` under the discard
 * confirm copy. When the agent has no active version (pre-setup) there is nothing
 * to revert to, so just clear the dirty flag.
 */
export async function discardAgentDraft(input: { organizationId: string; agentId: string }) {
  const { organizationId, agentId } = input

  const loaded = await fromDatabase(
    database.query.Agent.findFirst({
      where: and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)),
      columns: { activeVersionId: true, hasUnpublishedChanges: true },
    }),
    'discard-agent-draft-load'
  )
  if (loaded.isErr()) return err(loaded.error)
  const agent = loaded.value
  if (!agent) return err(new Error('AGENT_NOT_FOUND'))

  if (!agent.activeVersionId) {
    if (agent.hasUnpublishedChanges) {
      const cleared = await fromDatabase(
        database
          .update(schema.Agent)
          .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
          .where(eq(schema.Agent.id, agentId)),
        'discard-agent-draft-clear'
      )
      if (cleared.isErr()) return err(cleared.error)
      await fireAgentCacheEvent(organizationId, agentId)
    }
    return ok(undefined)
  }

  return restoreAgentVersion({ organizationId, agentId, toVersionId: agent.activeVersionId })
}

/** Published versions, newest first — meta projection with editor name. */
export async function listAgentVersions(input: { organizationId: string; agentId: string }) {
  const result = await fromDatabase(
    database
      .select({
        id: schema.AgentVersion.id,
        versionNumber: schema.AgentVersion.versionNumber,
        label: schema.AgentVersion.label,
        editorId: schema.AgentVersion.editorId,
        editorName: schema.User.name,
        createdAt: schema.AgentVersion.createdAt,
        configHash: schema.AgentVersion.configHash,
      })
      .from(schema.AgentVersion)
      .leftJoin(schema.User, eq(schema.User.id, schema.AgentVersion.editorId))
      .where(
        and(
          eq(schema.AgentVersion.agentId, input.agentId),
          eq(schema.AgentVersion.organizationId, input.organizationId)
        )
      )
      .orderBy(desc(schema.AgentVersion.versionNumber)),
    'list-agent-versions'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value as AgentVersionMeta[])
}

/**
 * Rename a published version's `label` (annotation metadata — a documented
 * immutability exception alongside the mention amendment). Org+agent scoped.
 */
export async function renameAgentVersion(input: {
  organizationId: string
  agentId: string
  versionId: string
  label: string | null
}) {
  const { organizationId, agentId, versionId, label } = input
  const result = await fromDatabase(
    database
      .update(schema.AgentVersion)
      .set({ label: label?.trim() || null })
      .where(
        and(
          eq(schema.AgentVersion.id, versionId),
          eq(schema.AgentVersion.agentId, agentId),
          eq(schema.AgentVersion.organizationId, organizationId)
        )
      )
      .returning({ id: schema.AgentVersion.id }),
    'rename-agent-version'
  )
  if (result.isErr()) return err(result.error)
  if (result.value.length === 0) return err(new Error('VERSION_NOT_FOUND'))
  return ok(undefined)
}

/** Bust the `agents` cache so the active-version view refreshes after a write. */
async function fireAgentCacheEvent(organizationId: string, agentId: string): Promise<void> {
  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (error) {
    logger.warn('Failed to invalidate caches after agent version write', {
      organizationId,
      agentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
