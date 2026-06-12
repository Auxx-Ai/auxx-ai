// packages/lib/src/agents/procedures/mention-reconcile.ts

import type { KnowledgeEntry } from '@auxx/database'
import { database, schema, type ToolsetEntry } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, or } from 'drizzle-orm'
import { onCacheEvent } from '../../cache'
import { getRealtimeService, publishAgentUpdated } from '../../realtime'
import { hashAgentConfig } from '../agent-config-snapshot'
import {
  reconcileKnowledgeMentions,
  reconcileToolsetMentions,
  walkPromptDocs,
} from '../prompt-mention-reconciler'
import { getOrgToolCatalog } from '../toolset-catalog'

const logger = createScopedLogger('procedure-mention-reconcile')

/**
 * Recompute the **`'procedure'`** mention tag on one agent's `Agent.toolsets` /
 * `Agent.knowledge` from its enabled attached procedures' docs.
 *
 * A `tool:`/record chip in a procedure doc enables its target on every agent the
 * procedure is attached to — symmetric to the prompt path, but provenance-tagged
 * `'procedure'` so the prompt-autosave reconciler never touches (or has to read)
 * it. The procedure tag spans BOTH the draft and active version docs (D1): the
 * eval suggester + editor read the draft pre-publish; the runtime reads the
 * active. Over-enabling a draft-only tool is intentional — the capability is
 * present but only *instructed* by the version that references it.
 *
 * Runs post-commit relative to the procedure write that triggered it; the per-tag
 * reconciler is an idempotent full recompute, so a separate transaction is safe.
 */
export async function reconcileAgentProcedureMentions(
  organizationId: string,
  agentId: string
): Promise<void> {
  // Draft + active docs of every ENABLED attached procedure, in one query.
  const rows = await database
    .select({ doc: schema.ProcedureVersion.doc })
    .from(schema.AgentProcedure)
    .innerJoin(schema.Procedure, eq(schema.Procedure.id, schema.AgentProcedure.procedureId))
    .innerJoin(
      schema.ProcedureVersion,
      or(
        eq(schema.ProcedureVersion.id, schema.Procedure.draftVersionId),
        eq(schema.ProcedureVersion.id, schema.Procedure.activeVersionId)
      )
    )
    .where(
      and(
        eq(schema.AgentProcedure.agentId, agentId),
        eq(schema.AgentProcedure.organizationId, organizationId),
        eq(schema.AgentProcedure.enabled, true)
      )
    )

  const docs = rows.map((r) => (r.doc ?? {}) as Record<string, unknown>)
  const catalog = await getOrgToolCatalog(organizationId)
  const { toolsetLocks, recordIds } = walkPromptDocs(docs, catalog)

  await database.transaction(async (tx) => {
    const [agent] = await tx
      .select({
        toolsets: schema.Agent.toolsets,
        knowledge: schema.Agent.knowledge,
        activeVersionId: schema.Agent.activeVersionId,
      })
      .from(schema.Agent)
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
      .for('update')
      .limit(1)
    if (!agent) return

    const toolsets = reconcileToolsetMentions(agent.toolsets ?? [], toolsetLocks, 'procedure')
    const knowledge = reconcileKnowledgeMentions(agent.knowledge ?? [], recordIds, 'procedure')
    // No dirty flag: the same derived change lands on BOTH the row and the active
    // version, so row-vs-active equality (and the no-op-publish hash) is preserved.
    await tx
      .update(schema.Agent)
      .set({ toolsets, knowledge, updatedAt: new Date() })
      .where(eq(schema.Agent.id, agentId))

    // Immutability exception (build-plan §3): amend ONLY the derived
    // (`source: 'mention'`) rows on the active version in place so the live
    // runtime reflects today's procedures without a republish, then recompute
    // its `configHash` so the no-op-publish check stays honest. Never touches
    // authored config.
    if (agent.activeVersionId) {
      const active = await tx.query.AgentVersion.findFirst({
        where: eq(schema.AgentVersion.id, agent.activeVersionId),
      })
      if (active) {
        const versionToolsets = reconcileToolsetMentions(
          (active.toolsets ?? []) as ToolsetEntry[],
          toolsetLocks,
          'procedure'
        )
        const versionKnowledge = reconcileKnowledgeMentions(
          (active.knowledge ?? []) as KnowledgeEntry[],
          recordIds,
          'procedure'
        )
        await tx
          .update(schema.AgentVersion)
          .set({
            toolsets: versionToolsets,
            knowledge: versionKnowledge,
            configHash: hashAgentConfig({
              ...active,
              toolsets: versionToolsets,
              knowledge: versionKnowledge,
            }),
          })
          .where(eq(schema.AgentVersion.id, active.id))
      }
    }
  })

  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after procedure mention reconcile', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
}

/**
 * Enabled-link agent ids for a procedure — the fan-out set for a procedure-side
 * edit (draft save, publish, revert, discard). Reverse of `listAgentProcedures`.
 * De-duped.
 */
export async function listAgentIdsForProcedure(
  organizationId: string,
  procedureId: string
): Promise<string[]> {
  const rows = await database
    .select({ agentId: schema.AgentProcedure.agentId })
    .from(schema.AgentProcedure)
    .where(
      and(
        eq(schema.AgentProcedure.procedureId, procedureId),
        eq(schema.AgentProcedure.organizationId, organizationId),
        eq(schema.AgentProcedure.enabled, true)
      )
    )
  return [...new Set(rows.map((r) => r.agentId))]
}

/**
 * Reconcile the `'procedure'` tag on a list of agents. One failure is logged and
 * skipped so the rest still settle. Used by procedure-delete (ids captured before
 * the cascade) and any explicit fan-out.
 */
export async function reconcileProcedureMentionsForAgents(
  organizationId: string,
  agentIds: string[]
): Promise<void> {
  for (const agentId of agentIds) {
    try {
      await reconcileAgentProcedureMentions(organizationId, agentId)
    } catch (err) {
      logger.warn('Failed to reconcile procedure mentions for agent', {
        organizationId,
        agentId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Fan a procedure-side edit out to every agent the procedure is attached to
 * (enabled links). Triggers: draft-doc save, publish, revert, discard.
 */
export async function reconcileProcedureMentionsForAllAgents(
  organizationId: string,
  procedureId: string
): Promise<void> {
  const agentIds = await listAgentIdsForProcedure(organizationId, procedureId)
  if (agentIds.length > 8) {
    logger.info('Large procedure mention fan-out', {
      organizationId,
      procedureId,
      agentCount: agentIds.length,
    })
  }
  await reconcileProcedureMentionsForAgents(organizationId, agentIds)
}
