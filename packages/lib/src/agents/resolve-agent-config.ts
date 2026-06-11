// packages/lib/src/agents/resolve-agent-config.ts

import type { Database } from '@auxx/database'
import { database as defaultDb, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { loadMasterKopilotSettings } from '../ai/kopilot/load-master-settings'
import { getCachedAgents } from '../cache/org-cache-helpers'
import type { AgentToolsetConfig } from './agent-toolset-types'
import type { ToolBindingMap } from './bindings'
import type { ToolsetEntry } from './prompt-mention-reconciler'
import { getOrgToolsetCatalog, type ToolsetCatalogEntry } from './toolset-catalog'

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
  /** Toolset slugs enabled + their per-tool overrides. */
  toolsets: Array<{
    slug: string
    disabledTools: ReadonlySet<string>
  }>
  /**
   * Per-app explicit credential pin. For agents this comes from
   * `Agent.appAccounts`; for master, from `kopilot.appAccounts`. Missing
   * appId = app's tools off for this session.
   */
  appAccounts: Record<string, { credId: string }>
  /**
   * Per-agent tool-binding **override** map — tool name → input → VarSource.
   * Usually empty (author defaults cover the common case); empty for master
   * Kopilot sessions. See plans/chat/v8 phase-5.
   */
  toolRestrictions: ToolBindingMap
  /** Per-agent / per-master override. null = inherit org/system default. */
  modelId: string | null
}

/**
 * Resolve the per-session agent configuration. Master sessions read the
 * org-scoped `kopilot.*` settings (with catalog defaults). Agent sessions
 * read the cached Agent row; toolsets live on the row itself (no DB round trip).
 *
 * `opts.source` selects the agent behavior view (build-plan §4.2):
 *  - `'active'` (default): the cached active-version view — what production runs.
 *  - `'draft'`: the live Agent row, read directly from the DB (authoring path;
 *    the draft view is deliberately not cached). Identity fields still resolve
 *    through the same cache fallbacks.
 *
 * Throws if the agent does not exist in the org, or if it has been archived.
 */
export async function resolveAgentConfig(
  orgId: string,
  agentId: string | null,
  db: Database = defaultDb as Database,
  opts?: { source?: 'active' | 'draft' }
): Promise<ResolvedAgentConfig> {
  if (agentId === null) {
    const [master, catalog] = await Promise.all([
      loadMasterKopilotSettings(orgId),
      getOrgToolsetCatalog(orgId),
    ])
    const toolsets = buildMasterToolsets(master.toolsets, master.appAccounts, catalog)
    return {
      agentId: null,
      name: 'Kopilot',
      userId: null,
      prompt: null,
      description: null,
      toolsets,
      appAccounts: master.appAccounts,
      toolRestrictions: {},
      modelId: master.modelId,
    }
  }

  const cached = await getCachedAgents(orgId)
  const agent = cached.find((a) => a.id === agentId)
  if (!agent) {
    throw new Error(`Agent not found in org ${orgId}: ${agentId}`)
  }

  // Behavior fields default to the cached active-version view; in draft mode
  // overlay them with a direct Agent-row read (identity stays cache-resolved).
  let behavior = {
    prompt: agent.prompt as Record<string, unknown>,
    toolsets: agent.toolsets,
    appAccounts: agent.appAccounts ?? {},
    toolRestrictions: (agent.toolRestrictions ?? {}) as ToolBindingMap,
    modelId: agent.modelId,
  }
  if (opts?.source === 'draft') {
    const [row] = await db
      .select({
        prompt: schema.Agent.prompt,
        toolsets: schema.Agent.toolsets,
        appAccounts: schema.Agent.appAccounts,
        toolRestrictions: schema.Agent.toolRestrictions,
        modelId: schema.Agent.modelId,
      })
      .from(schema.Agent)
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, orgId)))
      .limit(1)
    if (row) {
      behavior = {
        prompt: (row.prompt ?? {}) as Record<string, unknown>,
        toolsets: row.toolsets ?? [],
        appAccounts: row.appAccounts ?? {},
        toolRestrictions: (row.toolRestrictions ?? {}) as ToolBindingMap,
        modelId: row.modelId ?? null,
      }
    }
  }

  const toolsets = behavior.toolsets
    .filter((t) => t.enabled)
    .map((t) => {
      const config = (t.config ?? {}) as AgentToolsetConfig
      const disabled = Array.isArray(config.disabledTools) ? config.disabledTools : []
      return {
        slug: t.slug,
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
    prompt: behavior.prompt,
    description: agent.description,
    toolsets,
    appAccounts: behavior.appAccounts,
    // The DB stores `ref` structurally (string | string[]); the runtime narrows
    // it to a `VarRef`.
    toolRestrictions: behavior.toolRestrictions,
    modelId: behavior.modelId,
  }
}

/**
 * Build the master Kopilot enabled-toolsets list:
 *  - Native slugs: glob-expand `kopilot.toolsets` against the registered
 *    native catalog (specific entries override wildcards).
 *  - App slugs: include every toolset whose `appId` has a binding in
 *    `kopilot.appAccounts`. Apps without a pin contribute nothing.
 */
function buildMasterToolsets(
  stored: ToolsetEntry[],
  appAccounts: Record<string, { credId: string }>,
  catalog: ToolsetCatalogEntry[]
): Array<{ slug: string; disabledTools: ReadonlySet<string> }> {
  // Native = neither app nor MCP. App slugs enable via appAccounts pins (below); MCP slugs
  // (`mcp:<serverId>`) are exact-match only (no wildcard expansion) and arrive as enabled
  // `stored` entries, kept by the loop below. Connections are org-wide — no pin required.
  const nativeRegistered = catalog
    .filter((c) => !c.slug.startsWith('app:') && !c.slug.startsWith('mcp:'))
    .map((c) => c.slug)
  const expanded = expandStoredToolsets(stored, nativeRegistered)

  const result: Array<{ slug: string; disabledTools: ReadonlySet<string> }> = []
  const seen = new Set<string>()
  for (const entry of expanded) {
    if (!entry.enabled) continue
    if (seen.has(entry.slug)) continue
    seen.add(entry.slug)
    const config = (entry.config ?? {}) as AgentToolsetConfig
    const disabled = Array.isArray(config.disabledTools) ? config.disabledTools : []
    result.push({
      slug: entry.slug,
      disabledTools: new Set(disabled) as ReadonlySet<string>,
    })
  }

  for (const cat of catalog) {
    if (!cat.slug.startsWith('app:')) continue
    if (!appAccounts[cat.appId]) continue
    if (seen.has(cat.slug)) continue
    seen.add(cat.slug)
    result.push({ slug: cat.slug, disabledTools: new Set() })
  }

  return result
}

function expandStoredToolsets(
  entries: ToolsetEntry[],
  registeredNativeSlugs: string[]
): ToolsetEntry[] {
  const specific = new Set(entries.filter((e) => !e.slug.endsWith('*')).map((e) => e.slug))
  const out: ToolsetEntry[] = []
  for (const entry of entries) {
    if (entry.slug.endsWith('*')) {
      const prefix = entry.slug.slice(0, -1)
      for (const slug of registeredNativeSlugs) {
        if (slug.startsWith(prefix) && !specific.has(slug)) {
          out.push({
            slug,
            enabled: entry.enabled,
            source: entry.source,
            config: {},
          })
        }
      }
    } else {
      out.push(entry)
    }
  }
  return out
}
