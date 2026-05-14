// packages/lib/src/agents/agent-toolset-service.ts

import {
  type AgentToolsetEntity,
  type Database,
  database as defaultDb,
  schema,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import type { AgentToolsetConfig } from './agent-toolset-types'

const logger = createScopedLogger('agent-toolset-service')

/**
 * Patch shape applied to a single `(agentId, toolsetSlug)` row. Both
 * `enabled` and `disabledTools` are independently optional so callers can
 * patch just what changed.
 */
export interface AgentToolsetPatch {
  slug: string
  enabled?: boolean
  disabledTools?: string[]
}

/**
 * List the toolset rows for one agent. Toolsets are not currently cached
 * (per-agent row count is O(10)); this is a single indexed DB read.
 */
export async function listAgentToolsets(
  agentId: string,
  db: Database = defaultDb as Database
): Promise<AgentToolsetEntity[]> {
  return db.select().from(schema.AgentToolset).where(eq(schema.AgentToolset.agentId, agentId))
}

/**
 * Upsert one toolset row inside a caller-provided tx. Newly inserted rows
 * land with `source='manual'`; existing `auto_default` rows are promoted to
 * `manual` on first admin save (first-touch promotion).
 */
async function applyToolsetPatch(
  tx: Transaction,
  agentId: string,
  patch: AgentToolsetPatch
): Promise<void> {
  const now = new Date()

  const [existing] = await tx
    .select({
      id: schema.AgentToolset.id,
      config: schema.AgentToolset.config,
      source: schema.AgentToolset.source,
    })
    .from(schema.AgentToolset)
    .where(
      and(eq(schema.AgentToolset.agentId, agentId), eq(schema.AgentToolset.toolsetSlug, patch.slug))
    )
    .limit(1)

  if (existing) {
    const nextConfig: AgentToolsetConfig = { ...(existing.config as AgentToolsetConfig) }
    if (patch.disabledTools !== undefined) {
      nextConfig.disabledTools = patch.disabledTools
    }
    const update: Record<string, unknown> = { updatedAt: now, config: nextConfig }
    if (patch.enabled !== undefined) update.enabled = patch.enabled
    if (existing.source === 'auto_default') update.source = 'manual'
    await tx.update(schema.AgentToolset).set(update).where(eq(schema.AgentToolset.id, existing.id))
    return
  }

  const config: AgentToolsetConfig = {}
  if (patch.disabledTools !== undefined) config.disabledTools = patch.disabledTools
  await tx.insert(schema.AgentToolset).values({
    agentId,
    toolsetSlug: patch.slug,
    config,
    source: 'manual',
    enabled: patch.enabled ?? true,
    updatedAt: now,
  })
}

/**
 * Update one toolset row for an agent. Wraps `applyToolsetPatch` in a tx and
 * emits the `agent.updated` cache event so dependent caches refresh.
 */
export async function updateAgentToolset(
  organizationId: string,
  agentId: string,
  patch: AgentToolsetPatch,
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    await applyToolsetPatch(tx, agentId, patch)
  })

  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after toolset update', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Apply many toolset patches for an agent atomically. Rows not in the patch
 * list are left untouched — callers send the full set they want to enable,
 * plus explicit `enabled: false` for ones they unchecked.
 */
export async function batchUpdateAgentToolsets(
  organizationId: string,
  agentId: string,
  patches: AgentToolsetPatch[],
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const patch of patches) {
      await applyToolsetPatch(tx, agentId, patch)
    }
  })

  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after toolset batch update', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
