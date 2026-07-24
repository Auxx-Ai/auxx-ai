// packages/lib/src/agents/resolve-agent-config.ts

import type { AgentKind, Database, KnowledgeEntry } from '@auxx/database'
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
  /**
   * Invocation-surface discriminator from the Agent row (`internal | chat`) —
   * what the agent *is* and where it binds. Master Kopilot is `'internal'`.
   * NOT the per-run prompt `audience` (a chat-kind agent serves a customer, but
   * audience is computed at the entry point, never read off `kind`).
   */
  kind: AgentKind
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
  /**
   * Toolset slugs enabled + their per-tool allow-list. `enabledTools === null`
   * means the entry carries no per-tool config (explicit bundle) — every
   * member tool passes; a set keeps exactly the listed registered names.
   */
  toolsets: Array<{
    slug: string
    enabledTools: ReadonlySet<string> | null
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
  /**
   * The agent's retrieval scope (plans/permissions/v2/15-agent-knowledge-scope.md
   * §1.1): raw `Agent.knowledge` rows, resolved via `resolveAgentKnowledgeScope`
   * into the concrete datasets/articles `search_knowledge` and the prompt's
   * Knowledge Catalog may look at. `[]` = unrestricted, org-wide knowledge —
   * today's behavior, and the default for master Kopilot (which has no
   * knowledge scope of its own).
   */
  knowledge: KnowledgeEntry[]
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
      kind: 'internal',
      name: 'Kopilot',
      userId: null,
      prompt: null,
      description: null,
      toolsets,
      appAccounts: master.appAccounts,
      toolRestrictions: {},
      modelId: master.modelId,
      knowledge: [],
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
    knowledge: agent.knowledge,
    appAccounts: agent.appAccounts ?? {},
    toolRestrictions: (agent.toolRestrictions ?? {}) as ToolBindingMap,
    modelId: agent.modelId,
  }
  if (opts?.source === 'draft') {
    const [row] = await db
      .select({
        prompt: schema.Agent.prompt,
        toolsets: schema.Agent.toolsets,
        knowledge: schema.Agent.knowledge,
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
        knowledge: row.knowledge ?? [],
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
      return {
        slug: t.slug,
        enabledTools: Array.isArray(config.enabledTools)
          ? (new Set(config.enabledTools) as ReadonlySet<string>)
          : null,
      }
    })

  return {
    agentId: agent.id,
    kind: agent.kind,
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
    knowledge: behavior.knowledge,
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
): Array<{ slug: string; enabledTools: ReadonlySet<string> | null }> {
  // Native = neither app nor MCP. App slugs enable via appAccounts pins (below); MCP slugs
  // (`mcp:<serverId>`) are exact-match only (no wildcard expansion) and arrive as enabled
  // `stored` entries, kept by the loop below. Connections are org-wide — no pin required.
  const nativeRegistered = catalog
    .filter((c) => !c.slug.startsWith('app:') && !c.slug.startsWith('mcp:'))
    .map((c) => c.slug)
  const expanded = expandStoredToolsets(stored, nativeRegistered)

  const result: Array<{ slug: string; enabledTools: ReadonlySet<string> | null }> = []
  const seen = new Set<string>()
  for (const entry of expanded) {
    if (!entry.enabled) continue
    if (seen.has(entry.slug)) continue
    seen.add(entry.slug)
    const config = (entry.config ?? {}) as AgentToolsetConfig
    result.push({
      slug: entry.slug,
      enabledTools: Array.isArray(config.enabledTools)
        ? (new Set(config.enabledTools) as ReadonlySet<string>)
        : null,
    })
  }

  for (const cat of catalog) {
    if (!cat.slug.startsWith('app:')) continue
    if (!appAccounts[cat.appId]) continue
    if (seen.has(cat.slug)) continue
    seen.add(cat.slug)
    result.push({ slug: cat.slug, enabledTools: null })
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
