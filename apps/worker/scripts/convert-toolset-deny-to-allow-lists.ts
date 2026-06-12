// apps/worker/scripts/convert-toolset-deny-to-allow-lists.ts
/**
 * One-time conversion for the allow-list polarity flip
 * (plans/mcp/v4/tool-first-catalog.md Phase 0).
 *
 * Rewrites every `Agent.toolsets[*].config` (and `AgentVersion.toolsets[*]`)
 * that carries the old `disabledTools` deny-list into the new `enabledTools`
 * allow-list: `enabledTools = catalogNames(slug) − disabledTools`, resolved
 * against the org's live toolset catalog. Entries whose slug no longer exists
 * in the catalog (e.g. a disconnected MCP server) convert to an **empty**
 * allow-list — fail-closed, matching the model the flip exists for.
 *
 * Idempotent: only entries with a `disabledTools` key are touched; the key is
 * removed after conversion.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/convert-toolset-deny-to-allow-lists.ts
 */

import { database, schema } from '@auxx/database'
import { getOrgToolsetCatalog } from '@auxx/lib/agents'
import { eq, sql } from 'drizzle-orm'

interface LegacyEntry {
  slug: string
  config?: { disabledTools?: string[]; enabledTools?: string[]; [key: string]: unknown }
  [key: string]: unknown
}

const hasLegacyConfig = (entries: unknown[]): boolean =>
  entries.some((e) => Array.isArray((e as LegacyEntry).config?.disabledTools))

/** Per-org cache of slug → all registered tool names. */
const catalogCache = new Map<string, Map<string, string[]>>()

async function namesBySlug(organizationId: string): Promise<Map<string, string[]>> {
  let cached = catalogCache.get(organizationId)
  if (!cached) {
    const catalog = await getOrgToolsetCatalog(organizationId)
    cached = new Map(catalog.map((c) => [c.slug, c.tools.map((t) => t.name)]))
    catalogCache.set(organizationId, cached)
  }
  return cached
}

function convertEntries(entries: LegacyEntry[], catalog: Map<string, string[]>): LegacyEntry[] {
  return entries.map((entry) => {
    const disabled = entry.config?.disabledTools
    if (!Array.isArray(disabled)) return entry
    const allNames = catalog.get(entry.slug)
    if (!allNames) {
      console.warn(`  slug "${entry.slug}" not in catalog — converting to empty allow-list`)
    }
    const denySet = new Set(disabled)
    const { disabledTools: _dropped, ...restConfig } = entry.config ?? {}
    return {
      ...entry,
      config: {
        ...restConfig,
        enabledTools: (allNames ?? []).filter((name) => !denySet.has(name)),
      },
    }
  })
}

async function convertAgents() {
  console.log('Converting Agent.toolsets deny-lists to allow-lists...')
  const agents = await database
    .select({
      id: schema.Agent.id,
      organizationId: schema.Agent.organizationId,
      toolsets: schema.Agent.toolsets,
    })
    .from(schema.Agent)
    .where(sql`toolsets::text LIKE '%disabledTools%'`)

  let converted = 0
  for (const agent of agents) {
    const entries = (agent.toolsets ?? []) as LegacyEntry[]
    if (!hasLegacyConfig(entries)) continue
    const catalog = await namesBySlug(agent.organizationId)
    const next = convertEntries(entries, catalog)
    await database
      .update(schema.Agent)
      .set({ toolsets: next as typeof agent.toolsets })
      .where(eq(schema.Agent.id, agent.id))
    converted++
  }
  console.log(`  converted ${converted}/${agents.length} agent row(s)`)
}

async function convertAgentVersions() {
  console.log('Converting AgentVersion.toolsets deny-lists to allow-lists...')
  const versions = await database
    .select({
      id: schema.AgentVersion.id,
      organizationId: schema.AgentVersion.organizationId,
      toolsets: schema.AgentVersion.toolsets,
    })
    .from(schema.AgentVersion)
    .where(sql`${schema.AgentVersion.toolsets}::text LIKE '%disabledTools%'`)

  let converted = 0
  for (const version of versions) {
    const entries = (version.toolsets ?? []) as LegacyEntry[]
    if (!hasLegacyConfig(entries)) continue
    const catalog = await namesBySlug(version.organizationId)
    const next = convertEntries(entries, catalog)
    await database
      .update(schema.AgentVersion)
      .set({ toolsets: next })
      .where(eq(schema.AgentVersion.id, version.id))
    converted++
  }
  console.log(`  converted ${converted}/${versions.length} agent-version row(s)`)
}

async function main() {
  try {
    await convertAgents()
    await convertAgentVersions()
    console.log('Conversion complete.')
    process.exit(0)
  } catch (err) {
    console.error('Conversion failed:', err)
    process.exit(1)
  }
}

main()
