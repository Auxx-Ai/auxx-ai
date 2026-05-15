// packages/lib/src/agents/resolve-agent-config.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getCachedAgents } from '../cache/org-cache-helpers'
import type { AgentToolsetConfig } from './agent-toolset-types'

/**
 * Resolved per-session agent configuration. Returned for both master Kopilot
 * sessions (sentinel) and user-authored agent sessions.
 */
export interface ResolvedAgentConfig {
  /** null = master Kopilot session. */
  agentId: string | null
  /** Master = 'Kopilot'. */
  name: string
  /** Backing User row id. null for master. */
  userId: string | null
  /** Tiptap doc; null for master. */
  prompt: Record<string, unknown> | null
  /**
   * Optional one-line description authored by the agent creator. Null for
   * master.
   */
  description: string | null
  /** Toolset slugs enabled + their per-tool overrides. Empty for master. */
  toolsets: Array<{
    slug: string
    disabledTools: ReadonlySet<string>
  }>
  /** Per-agent override. null = inherit org/system default. */
  modelId: string | null
}

const MASTER_SENTINEL: ResolvedAgentConfig = {
  agentId: null,
  name: 'Kopilot',
  userId: null,
  prompt: null,
  description: null,
  toolsets: [],
  modelId: null,
}

/**
 * Resolve the per-session agent configuration. Master sessions return a
 * sentinel without touching the DB. Agent sessions read the cached Agent row
 * (modelId/prompt included) plus a fresh DB read of `AgentToolset` rows
 * (no cache today; row count per agent is O(10)).
 *
 * Throws if the agent does not exist in the org, or if it has been archived.
 */
export async function resolveAgentConfig(
  orgId: string,
  agentId: string | null,
  db: Database = defaultDb as Database
): Promise<ResolvedAgentConfig> {
  if (agentId === null) return MASTER_SENTINEL

  const cached = await getCachedAgents(orgId)
  const agent = cached.find((a) => a.id === agentId)
  if (!agent) {
    throw new Error(`Agent not found in org ${orgId}: ${agentId}`)
  }

  const toolsetRows = await db
    .select({
      slug: schema.AgentToolset.toolsetSlug,
      config: schema.AgentToolset.config,
    })
    .from(schema.AgentToolset)
    .where(and(eq(schema.AgentToolset.agentId, agentId), eq(schema.AgentToolset.enabled, true)))

  const toolsets = toolsetRows.map((row) => {
    const config = (row.config ?? {}) as AgentToolsetConfig
    const disabled = Array.isArray(config.disabledTools) ? config.disabledTools : []
    return {
      slug: row.slug,
      disabledTools: new Set(disabled) as ReadonlySet<string>,
    }
  })

  return {
    agentId: agent.id,
    // Setup-mode drafts may have a null name; the engine just needs *something*
    // for log lines and turn breadcrumbs. The UI's placeholder string is the
    // honest fallback.
    name: agent.name ?? 'Untitled agent',
    userId: agent.userId,
    prompt: agent.prompt,
    description: agent.description,
    toolsets,
    modelId: agent.modelId,
  }
}
