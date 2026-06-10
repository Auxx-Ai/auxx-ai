// packages/lib/src/agents/agent-version-service.ts

import { type AgentVersionEntity, database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, desc, eq, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { onCacheEvent } from '../cache'
import { hashAgentConfig, snapshotAgentConfig } from './agent-config-snapshot'
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
}

/**
 * Snapshot the Agent row's current behavior config into a new numbered
 * `AgentVersion` and repoint `activeVersionId`, on a caller-provided transaction
 * so it composes with `completeAgentSetup`. Rejects pre-setup agents. No-op
 * republish: if the active version's `configHash` already equals the row
 * snapshot's hash, just clear the dirty flag and return the active version.
 * Throws on failure so the outer transaction rolls back.
 */
export async function publishAgentTx(
  tx: Transaction,
  input: PublishAgentTxInput
): Promise<AgentVersionEntity> {
  const { organizationId, agentId, editorId, label } = input
  const now = new Date()

  const agent = await tx.query.Agent.findFirst({
    where: and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)),
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  if (!agent.setupCompletedAt) throw new Error('AGENT_NOT_SETUP')

  const snapshot = snapshotAgentConfig(agent)
  const configHash = hashAgentConfig(agent)

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
      return active
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
      configHash,
      editorId: editorId ?? null,
    })
    .returning()
  if (!published) throw new Error('Failed to insert AgentVersion')

  await tx
    .update(schema.Agent)
    .set({ activeVersionId: published.id, hasUnpublishedChanges: false, updatedAt: now })
    .where(eq(schema.Agent.id, agentId))

  return published
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
 * Restore-as-draft (article semantic): copy a published version's six behavior
 * fields back onto the Agent row and mark dirty by hash-compare against the
 * **active** version (restoring config equal to active ≙ discard, not dirty).
 * `activeVersionId` is NOT touched — nothing goes live until publish. Post-tx
 * re-runs the procedure-mention reconciler: attached procedure docs may have
 * changed since this version, so the derived rows must re-derive against today's
 * procedures.
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
        columns: { activeVersionId: true },
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

      await tx
        .update(schema.Agent)
        .set({
          prompt: target.prompt,
          toolsets: target.toolsets,
          knowledge: target.knowledge,
          appAccounts: target.appAccounts,
          toolRestrictions: target.toolRestrictions,
          modelId: target.modelId,
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
