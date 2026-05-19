// packages/lib/src/agents/resolve-agent-config.ts

import type { Database } from '@auxx/database'
import { database as defaultDb } from '@auxx/database'
import { loadMasterKopilotSettings } from '../ai/kopilot/load-master-settings'
import { getCachedAgents } from '../cache/org-cache-helpers'
import type { AgentToolsetConfig } from './agent-toolset-types'
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
  /** Per-agent / per-master override. null = inherit org/system default. */
  modelId: string | null
}

/**
 * Resolve the per-session agent configuration. Master sessions read the
 * org-scoped `kopilot.*` settings (with catalog defaults). Agent sessions
 * read the cached Agent row; toolsets live on the row itself (no DB round trip).
 *
 * Throws if the agent does not exist in the org, or if it has been archived.
 */
export async function resolveAgentConfig(
  orgId: string,
  agentId: string | null,
  _db: Database = defaultDb as Database
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
      modelId: master.modelId,
    }
  }

  const cached = await getCachedAgents(orgId)
  const agent = cached.find((a) => a.id === agentId)
  if (!agent) {
    throw new Error(`Agent not found in org ${orgId}: ${agentId}`)
  }

  const toolsets = agent.toolsets
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
    prompt: agent.prompt,
    description: agent.description,
    toolsets,
    appAccounts: agent.appAccounts ?? {},
    modelId: agent.modelId,
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
  const nativeRegistered = catalog.filter((c) => !c.slug.startsWith('app:')).map((c) => c.slug)
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
