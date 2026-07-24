// packages/lib/src/agents/agent-scope-service.ts

import {
  type Database,
  database as defaultDb,
  type KnowledgeEntry,
  schema,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq, sql } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { BadRequestError } from '../errors'
import { getRealtimeService, publishAgentUpdated } from '../realtime'
import { isKnowledgeScopeRecordId } from './knowledge-scope'

// CRUD for `Agent.knowledge` — the agent's **knowledge-source retrieval
// scope**: which knowledge bases, articles and datasets `search_knowledge`
// and the prompt's Knowledge Catalog draw from by default.
//
// This is NOT an access-control mechanism. Whether an agent (or the human
// running it) may read a given record is governed entirely by the permission
// layer (per-def / per-instance grants, doc 14,
// plans/permissions/v2/15-agent-knowledge-scope.md §0). Every `recordId`
// written here must target a knowledge source — see `isKnowledgeScopeRecordId`
// — so the two systems never get re-conflated.

const logger = createScopedLogger('agent-scope-service')

/**
 * Mark the draft dirty, but only when an active version exists to be dirty
 * against. See plans/agents/agent-versions/build-plan.md §2.1.
 */
const MARK_DIRTY_IF_PUBLISHED = sql`${schema.Agent.activeVersionId} is not null`

export type AgentScopeMode = 'include_descendants' | 'include_one' | 'exclude'

export interface AgentScopeUpsertInput {
  agentId: string
  /** `kb:<id>`, `article:<id>`, `dataset:<id>`, or a bare `kb`/`dataset` for definition-level. */
  recordId: string
  mode: AgentScopeMode
}

export interface AgentScopeRemoveInput {
  agentId: string
  recordId: string
}

function findScopeEntry(
  entries: KnowledgeEntry[],
  recordId: string
): { idx: number; entry: KnowledgeEntry | undefined } {
  const idx = entries.findIndex((k) => k.recordId === recordId)
  return { idx, entry: idx >= 0 ? entries[idx] : undefined }
}

async function loadKnowledgeForUpdate(tx: Transaction, agentId: string): Promise<KnowledgeEntry[]> {
  const [row] = await tx
    .select({ knowledge: schema.Agent.knowledge })
    .from(schema.Agent)
    .where(eq(schema.Agent.id, agentId))
    .for('update')
    .limit(1)
  if (!row) throw new ScopeRowImmutableError('Agent not found')
  return row.knowledge ?? []
}

/**
 * Upsert one knowledge-source scope row. Inserts default to `source='manual'`;
 * existing `manual` rows are mutated in place; `mention` rows are immutable
 * from this call site (the prompt reconciler owns them).
 *
 * @throws {BadRequestError} when `input.recordId` isn't a knowledge source
 *   (`kb` / `article` / `dataset`, see {@link isKnowledgeScopeRecordId}).
 */
export async function upsertAgentScopeRow(
  organizationId: string,
  input: AgentScopeUpsertInput,
  db: Database = defaultDb as Database
): Promise<void> {
  if (!isKnowledgeScopeRecordId(input.recordId)) {
    throw new BadRequestError(
      `recordId must target a knowledge source (kb, article, or dataset): "${input.recordId}"`
    )
  }
  await db.transaction(async (tx) => {
    const current = await loadKnowledgeForUpdate(tx, input.agentId)
    const { idx, entry } = findScopeEntry(current, input.recordId)
    if (entry?.source === 'mention') {
      throw new ScopeRowImmutableError(
        'Cannot edit a mention-pinned knowledge entry. Drop the mention in the persona prompt first.'
      )
    }
    const next: KnowledgeEntry = {
      recordId: input.recordId,
      mode: input.mode,
      // First-touch promotion: any non-manual entry becomes `manual` on an
      // explicit admin edit.
      source: 'manual',
    }
    const merged = idx >= 0 ? current.map((k, i) => (i === idx ? next : k)) : [...current, next]
    await tx
      .update(schema.Agent)
      .set({
        knowledge: merged,
        hasUnpublishedChanges: MARK_DIRTY_IF_PUBLISHED,
        updatedAt: new Date(),
      })
      .where(eq(schema.Agent.id, input.agentId))
  })
  await fireAgentUpdated(organizationId, input.agentId)
}

/**
 * Remove a knowledge-source scope row. Mention-sourced entries reject with an
 * error — those are managed by the prompt reconciler. Removing a
 * non-existent entry is a no-op. No `recordId` validation here on purpose:
 * removing a stale entity-record row left over from the deleted include
 * system must keep working.
 */
export async function removeAgentScopeRow(
  organizationId: string,
  input: AgentScopeRemoveInput,
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await loadKnowledgeForUpdate(tx, input.agentId)
    const { idx, entry } = findScopeEntry(current, input.recordId)
    if (!entry) return
    if (entry.source === 'mention') {
      throw new ScopeRowImmutableError(
        'Cannot remove a mention-pinned knowledge entry. Drop the mention in the persona prompt first.'
      )
    }
    const merged = current.filter((_, i) => i !== idx)
    await tx
      .update(schema.Agent)
      .set({
        knowledge: merged,
        hasUnpublishedChanges: MARK_DIRTY_IF_PUBLISHED,
        updatedAt: new Date(),
      })
      .where(eq(schema.Agent.id, input.agentId))
  })
  await fireAgentUpdated(organizationId, input.agentId)
}

/**
 * Replace the agent's full set of manual knowledge-source scope rows in one
 * transaction. Diff semantics:
 * - entries in `inputs` but not in the agent → insert (`source='manual'`)
 * - entries in both → update mode (and promote to `manual` if not already)
 * - entries on the agent but not in `inputs` → delete UNLESS `source='mention'`
 *   (mention entries are owned by the prompt reconciler and are preserved)
 *
 * @throws {BadRequestError} when any `inputs[].recordId` isn't a knowledge
 *   source (`kb` / `article` / `dataset`). Validated up front, before the
 *   transaction opens, so a bad row in a large batch never touches the DB.
 */
export async function batchSetAgentResourceScopes(
  organizationId: string,
  agentId: string,
  inputs: Array<{ recordId: string; mode: AgentScopeMode }>,
  db: Database = defaultDb as Database
): Promise<{ applied: number }> {
  for (const { recordId } of inputs) {
    if (!isKnowledgeScopeRecordId(recordId)) {
      throw new BadRequestError(
        `recordId must target a knowledge source (kb, article, or dataset): "${recordId}"`
      )
    }
  }

  const desired = new Map(inputs.map((row) => [row.recordId, row.mode]))

  await db.transaction(async (tx) => {
    const current = await loadKnowledgeForUpdate(tx, agentId)
    const next: KnowledgeEntry[] = []
    const handled = new Set<string>()
    for (const entry of current) {
      if (entry.source === 'mention') {
        next.push(entry)
        continue
      }
      const want = desired.get(entry.recordId)
      if (want !== undefined) {
        next.push({ recordId: entry.recordId, mode: want, source: 'manual' })
        handled.add(entry.recordId)
      }
      // Else: dropped (manual entry omitted from desired).
    }
    for (const [recordId, mode] of desired) {
      if (handled.has(recordId)) continue
      // Skip insert if a mention already covers this recordId; updating the
      // mention entry is not allowed from this call site.
      if (current.some((k) => k.recordId === recordId && k.source === 'mention')) continue
      next.push({ recordId, mode, source: 'manual' })
    }
    await tx
      .update(schema.Agent)
      .set({
        knowledge: next,
        hasUnpublishedChanges: MARK_DIRTY_IF_PUBLISHED,
        updatedAt: new Date(),
      })
      .where(eq(schema.Agent.id, agentId))
  })

  await fireAgentUpdated(organizationId, agentId)
  return { applied: desired.size }
}

async function fireAgentUpdated(organizationId: string, agentId: string): Promise<void> {
  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent scope update', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
}

export class ScopeRowImmutableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScopeRowImmutableError'
  }
}
