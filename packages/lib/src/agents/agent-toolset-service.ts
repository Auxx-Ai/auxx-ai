// packages/lib/src/agents/agent-toolset-service.ts

import {
  type Database,
  database as defaultDb,
  schema,
  type ToolsetEntry,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import type { AgentToolsetConfig } from './agent-toolset-types'

const logger = createScopedLogger('agent-toolset-service')

/**
 * Patch shape applied to a single `(agentId, toolsetSlug)` entry. Both
 * `enabled` and `disabledTools` are independently optional so callers can
 * patch just what changed.
 */
export interface AgentToolsetPatch {
  slug: string
  enabled?: boolean
  disabledTools?: string[]
}

/**
 * List the toolset entries for one agent. Reads the `Agent.toolsets` JSONB
 * column.
 */
export async function listAgentToolsets(
  agentId: string,
  db: Database = defaultDb as Database
): Promise<ToolsetEntry[]> {
  const [row] = await db
    .select({ toolsets: schema.Agent.toolsets })
    .from(schema.Agent)
    .where(eq(schema.Agent.id, agentId))
    .limit(1)
  return row?.toolsets ?? []
}

/**
 * Apply a patch to a current toolsets array. Pure function — caller persists
 * the result. Newly inserted entries land with `source='manual'`; existing
 * `auto_default` entries are promoted to `manual` on first admin save
 * (first-touch promotion). `mention` entries are owned by the prompt
 * reconciler and survive untouched.
 */
export function applyToolsetPatch(
  current: ToolsetEntry[],
  patch: AgentToolsetPatch
): ToolsetEntry[] {
  const idx = current.findIndex((t) => t.slug === patch.slug)
  if (idx === -1) {
    const config: AgentToolsetConfig = {}
    if (patch.disabledTools !== undefined) config.disabledTools = patch.disabledTools
    return [
      ...current,
      {
        slug: patch.slug,
        config,
        enabled: patch.enabled ?? true,
        source: 'manual',
      },
    ]
  }
  const existing = current[idx]!
  const nextConfig: AgentToolsetConfig = { ...(existing.config as AgentToolsetConfig) }
  if (patch.disabledTools !== undefined) {
    nextConfig.disabledTools = patch.disabledTools
  }
  const next: ToolsetEntry = {
    ...existing,
    config: nextConfig,
    enabled: patch.enabled ?? existing.enabled,
    source: existing.source === 'auto_default' ? 'manual' : existing.source,
  }
  return current.map((t, i) => (i === idx ? next : t))
}

async function loadToolsetsForUpdate(tx: Transaction, agentId: string): Promise<ToolsetEntry[]> {
  const [row] = await tx
    .select({ toolsets: schema.Agent.toolsets })
    .from(schema.Agent)
    .where(eq(schema.Agent.id, agentId))
    .for('update')
    .limit(1)
  if (!row) throw new Error(`Agent not found: ${agentId}`)
  return row.toolsets ?? []
}

/**
 * Update one toolset entry on an agent. Read-modify-write of `Agent.toolsets`
 * under a row lock so concurrent autosaves don't drop edits.
 */
export async function updateAgentToolset(
  organizationId: string,
  agentId: string,
  patch: AgentToolsetPatch,
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await loadToolsetsForUpdate(tx, agentId)
    const next = applyToolsetPatch(current, patch)
    await tx
      .update(schema.Agent)
      .set({ toolsets: next, updatedAt: new Date() })
      .where(eq(schema.Agent.id, agentId))
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
 * Apply many toolset patches for an agent in one transaction. Entries not in
 * the patch list are left untouched — callers send the full set they want to
 * enable, plus explicit `enabled: false` for ones they unchecked.
 */
export async function batchUpdateAgentToolsets(
  organizationId: string,
  agentId: string,
  patches: AgentToolsetPatch[],
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await loadToolsetsForUpdate(tx, agentId)
    let next = current
    for (const patch of patches) {
      next = applyToolsetPatch(next, patch)
    }
    await tx
      .update(schema.Agent)
      .set({ toolsets: next, updatedAt: new Date() })
      .where(eq(schema.Agent.id, agentId))
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
