// packages/lib/src/agents/agent-scope-service.ts

import {
  type AgentResourceScopeEntity,
  type Database,
  database as defaultDb,
  type PinnedRecord,
  schema,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { getCachedAgentById, onCacheEvent } from '../cache'

const logger = createScopedLogger('agent-scope-service')

const PIN_HARD_CAP = 50

export type AgentScopeMode = 'include_descendants' | 'include_one' | 'exclude'

export interface AgentScopeUpsertInput {
  agentId: string
  /** `${entityDefinitionId}:${entityInstanceId}` or `entityDefinitionId` for definition-level. */
  recordId: string
  mode: AgentScopeMode
}

export interface AgentScopeRemoveInput {
  agentId: string
  recordId: string
}

export interface AgentPinInput {
  agentId: string
  recordId: string
  pinned: boolean
  note?: string | null
}

/**
 * Parse a scope `recordId` string into the split column shape used in
 * `AgentResourceScope`. `'article:abc'` → `{ entityDefinitionId: 'article',
 * entityInstanceId: 'abc' }`. `'contact'` or `'contact:'` → `{
 * entityDefinitionId: 'contact', entityInstanceId: null }` (definition-level).
 */
export function parseRecordIdForScope(recordId: string): {
  entityDefinitionId: string
  entityInstanceId: string | null
} {
  const colon = recordId.indexOf(':')
  if (colon === -1) return { entityDefinitionId: recordId, entityInstanceId: null }
  const def = recordId.slice(0, colon)
  const instance = recordId.slice(colon + 1)
  return {
    entityDefinitionId: def,
    entityInstanceId: instance.length > 0 ? instance : null,
  }
}

function recordMatchesScopeRow(
  recordId: string,
  row: { entityDefinitionId: string; entityInstanceId: string | null }
): boolean {
  const parsed = parseRecordIdForScope(recordId)
  return (
    parsed.entityDefinitionId === row.entityDefinitionId &&
    parsed.entityInstanceId === row.entityInstanceId
  )
}

async function findScopeRowForUpdate(
  tx: Transaction,
  organizationId: string,
  agentId: string,
  recordId: string
): Promise<AgentResourceScopeEntity | undefined> {
  const { entityDefinitionId, entityInstanceId } = parseRecordIdForScope(recordId)
  const instanceFilter =
    entityInstanceId === null
      ? isNull(schema.AgentResourceScope.entityInstanceId)
      : eq(schema.AgentResourceScope.entityInstanceId, entityInstanceId)

  const [row] = await tx
    .select()
    .from(schema.AgentResourceScope)
    .where(
      and(
        eq(schema.AgentResourceScope.organizationId, organizationId),
        eq(schema.AgentResourceScope.agentId, agentId),
        eq(schema.AgentResourceScope.entityDefinitionId, entityDefinitionId),
        instanceFilter
      )
    )
    .limit(1)

  return row
}

async function upsertScopeRowInTx(
  tx: Transaction,
  organizationId: string,
  agentId: string,
  recordId: string,
  mode: AgentScopeMode
): Promise<void> {
  const now = new Date()
  const existing = await findScopeRowForUpdate(tx, organizationId, agentId, recordId)
  const { entityDefinitionId, entityInstanceId } = parseRecordIdForScope(recordId)

  if (existing) {
    await tx
      .update(schema.AgentResourceScope)
      .set({
        mode,
        // First-touch promotion: any non-manual row becomes `manual` on an
        // explicit admin edit. Mention pins promote so they survive prompt
        // changes; auto_defaults promote so they outlive the default set.
        source: 'manual',
        updatedAt: now,
      })
      .where(eq(schema.AgentResourceScope.id, existing.id))
    return
  }

  await tx.insert(schema.AgentResourceScope).values({
    agentId,
    organizationId,
    entityDefinitionId,
    entityInstanceId,
    mode,
    source: 'manual',
    updatedAt: now,
  })
}

/**
 * Upsert one scope row. Inserts default to `source='manual'`; existing
 * `mention`-sourced rows stay `mention` (the prompt reconciler owns them).
 */
export async function upsertAgentScopeRow(
  organizationId: string,
  input: AgentScopeUpsertInput,
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    await upsertScopeRowInTx(tx, organizationId, input.agentId, input.recordId, input.mode)
  })
  await fireAgentUpdated(organizationId, input.agentId)
}

/**
 * Remove a scope row. Mention-sourced rows reject with an error — those are
 * managed by the prompt reconciler. Removing a non-existent row is a no-op.
 */
export async function removeAgentScopeRow(
  organizationId: string,
  input: AgentScopeRemoveInput,
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await findScopeRowForUpdate(tx, organizationId, input.agentId, input.recordId)
    if (!existing) return
    if (existing.source === 'mention') {
      throw new ScopeRowImmutableError(
        'Cannot remove a mention-pinned scope row. Drop the mention in the persona prompt first.'
      )
    }
    await tx.delete(schema.AgentResourceScope).where(eq(schema.AgentResourceScope.id, existing.id))
  })
  await fireAgentUpdated(organizationId, input.agentId)
}

/**
 * Toggle a manual pin. When `pinned=true` and no scope row covers the record
 * yet, also inserts a `mode='include_one'` row (pin-implies-access, per
 * `knowledge-access.md` §2.2). Throws `PinLimitExceededError` when the agent
 * already has 50 pinned records.
 */
export async function setAgentPin(
  organizationId: string,
  input: AgentPinInput,
  db: Database = defaultDb as Database
): Promise<void> {
  const cached = await getCachedAgentById(organizationId, input.agentId)
  if (!cached) throw new ScopeRowImmutableError('Agent not found')

  const existing = cached.pinnedRecords
  const idx = existing.findIndex((p) => p.recordId === input.recordId)
  const current = idx === -1 ? undefined : existing[idx]

  let next: PinnedRecord[]
  if (input.pinned) {
    if (current) {
      // Already pinned — refresh note if provided; never overwrite a mention pin.
      if (current.pinReason === 'mention') return
      next = [...existing]
      next[idx] = {
        ...current,
        note: input.note ?? current.note,
      }
    } else {
      if (existing.length >= PIN_HARD_CAP) {
        throw new PinLimitExceededError(`Pin limit reached (${PIN_HARD_CAP})`)
      }
      const newPin: PinnedRecord = {
        recordId: input.recordId,
        pinReason: 'manual',
      }
      if (input.note != null) newPin.note = input.note
      next = [...existing, newPin]
    }
  } else {
    if (!current) return
    if (current.pinReason === 'mention') {
      throw new ScopeRowImmutableError(
        'Cannot unpin a mention-pinned record. Drop the mention in the persona prompt first.'
      )
    }
    next = existing.filter((_, i) => i !== idx)
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.Agent)
      .set({ pinnedRecords: next, updatedAt: new Date() })
      .where(eq(schema.Agent.id, input.agentId))

    // Pin-implies-access: when newly pinning, ensure a scope row exists.
    if (input.pinned && !current) {
      const existingRow = await findScopeRowForUpdate(
        tx,
        organizationId,
        input.agentId,
        input.recordId
      )
      if (!existingRow) {
        await upsertScopeRowInTx(tx, organizationId, input.agentId, input.recordId, 'include_one')
      }
    }
  })

  await fireAgentUpdated(organizationId, input.agentId)
}

/**
 * Replace the agent's full set of manual scope rows in one transaction.
 *
 * Diffs `inputs` against the existing rows for this agent. Behavior:
 * - rows in `inputs` but not in DB → insert (`source='manual'`)
 * - rows in both → update mode (and promote to `manual` if previously not)
 * - rows in DB but not in `inputs` → delete UNLESS `source='mention'` (mention
 *   rows are owned by the prompt reconciler and are preserved across calls)
 *
 * Returns the count of rows applied to the DB (insert + update + delete).
 */
export async function batchSetAgentResourceScopes(
  organizationId: string,
  agentId: string,
  inputs: Array<{ recordId: string; mode: AgentScopeMode }>,
  db: Database = defaultDb as Database
): Promise<{ applied: number }> {
  const desired = new Map(inputs.map((row) => [normalizeRecordId(row.recordId), row.mode]))

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.AgentResourceScope)
      .where(
        and(
          eq(schema.AgentResourceScope.organizationId, organizationId),
          eq(schema.AgentResourceScope.agentId, agentId)
        )
      )

    const existingByKey = new Map<string, AgentResourceScopeEntity>()
    for (const row of existing) {
      const key = serializeScopeKey(row.entityDefinitionId, row.entityInstanceId)
      existingByKey.set(key, row)
    }

    for (const [key, mode] of desired) {
      const { recordId } = deserializeScopeKey(key)
      await upsertScopeRowInTx(tx, organizationId, agentId, recordId, mode)
    }

    for (const [key, row] of existingByKey) {
      if (desired.has(key)) continue
      if (row.source === 'mention') continue
      await tx.delete(schema.AgentResourceScope).where(eq(schema.AgentResourceScope.id, row.id))
    }
  })

  await fireAgentUpdated(organizationId, agentId)
  return { applied: desired.size }
}

function normalizeRecordId(recordId: string): string {
  const { entityDefinitionId, entityInstanceId } = parseRecordIdForScope(recordId)
  return serializeScopeKey(entityDefinitionId, entityInstanceId)
}

function serializeScopeKey(defId: string, instanceId: string | null): string {
  return instanceId === null ? defId : `${defId}:${instanceId}`
}

function deserializeScopeKey(key: string): { recordId: string } {
  return { recordId: key }
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
}

export class PinLimitExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PinLimitExceededError'
  }
}

export class ScopeRowImmutableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScopeRowImmutableError'
  }
}

export { PIN_HARD_CAP, recordMatchesScopeRow }
