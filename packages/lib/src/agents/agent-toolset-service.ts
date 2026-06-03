// packages/lib/src/agents/agent-toolset-service.ts

import {
  type AgentKind,
  type AppAccountBinding,
  type Database,
  database as defaultDb,
  schema,
  type ToolRestrictionMap,
  type ToolsetEntry,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache, onCacheEvent } from '../cache'
import { getRealtimeService, publishAgentUpdated } from '../realtime'
import type { AgentToolsetConfig } from './agent-toolset-types'
import {
  type AutoRestrictionTool,
  buildResolvableVarIdSet,
  computeAutoRestrictions,
} from './compute-auto-restrictions'
import { buildRestrictionVarRegistry } from './restrictions'
import { getOrgToolsetCatalog } from './toolset-catalog'

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

interface AgentToolsetRow {
  kind: AgentKind
  toolsets: ToolsetEntry[]
  appAccounts: Record<string, AppAccountBinding>
  toolRestrictions: ToolRestrictionMap
}

async function loadAgentForToolsetUpdate(
  tx: Transaction,
  agentId: string
): Promise<AgentToolsetRow> {
  const [row] = await tx
    .select({
      kind: schema.Agent.kind,
      toolsets: schema.Agent.toolsets,
      appAccounts: schema.Agent.appAccounts,
      toolRestrictions: schema.Agent.toolRestrictions,
    })
    .from(schema.Agent)
    .where(eq(schema.Agent.id, agentId))
    .for('update')
    .limit(1)
  if (!row) throw new Error(`Agent not found: ${agentId}`)
  return {
    kind: row.kind,
    toolsets: row.toolsets ?? [],
    appAccounts: row.appAccounts ?? {},
    toolRestrictions: row.toolRestrictions ?? {},
  }
}

/**
 * Drop `appAccounts[appId]` entries for any app whose last enabled toolset
 * was just turned off. Returns the same object reference when no changes
 * are needed so callers can skip the write.
 */
async function clearOrphanedAppAccounts(
  organizationId: string,
  prevToolsets: ToolsetEntry[],
  nextToolsets: ToolsetEntry[],
  appAccounts: Record<string, AppAccountBinding>,
  patches: AgentToolsetPatch[]
): Promise<Record<string, AppAccountBinding>> {
  const disabledSlugs = patches.filter((p) => p.enabled === false).map((p) => p.slug)
  if (disabledSlugs.length === 0) return appAccounts
  if (Object.keys(appAccounts).length === 0) return appAccounts

  const catalog = await getOrgToolsetCatalog(organizationId)
  const slugToAppId = new Map(catalog.map((c) => [c.slug, c.appId]))

  const affectedAppIds = new Set<string>()
  const prevBySlug = new Map(prevToolsets.map((t) => [t.slug, t]))
  for (const slug of disabledSlugs) {
    if (prevBySlug.get(slug)?.enabled !== true) continue
    const appId = slugToAppId.get(slug)
    if (appId && appAccounts[appId]) affectedAppIds.add(appId)
  }
  if (affectedAppIds.size === 0) return appAccounts

  const enabledAppIds = new Set<string>()
  for (const entry of nextToolsets) {
    if (!entry.enabled) continue
    const appId = slugToAppId.get(entry.slug)
    if (appId) enabledAppIds.add(appId)
  }

  let changed = false
  const next: Record<string, AppAccountBinding> = { ...appAccounts }
  for (const appId of affectedAppIds) {
    if (!enabledAppIds.has(appId)) {
      delete next[appId]
      changed = true
    }
  }
  return changed ? next : appAccounts
}

/**
 * Build the `toolsetSlug → tools` map the auto-create pass reads, sourced from
 * the org installed-apps cache. Each `CachedAgentTool` already carries its
 * `registeredName` (the `toolRestrictions` key) and `identityScopedInputs`, so
 * native and app tools project uniformly. Cache-backed read — done before the
 * transaction.
 */
async function buildToolsBySlug(
  organizationId: string
): Promise<Map<string, AutoRestrictionTool[]>> {
  const installedApps = await getOrgCache().get(organizationId, 'installedApps')
  const bySlug = new Map<string, AutoRestrictionTool[]>()
  for (const app of installedApps) {
    for (const tool of app.agentTools ?? []) {
      if (!tool.identityScopedInputs || tool.identityScopedInputs.length === 0) continue
      const list = bySlug.get(tool.toolsetSlug) ?? []
      list.push({
        registeredName: tool.registeredName,
        identityScopedInputs: tool.identityScopedInputs,
      })
      bySlug.set(tool.toolsetSlug, list)
    }
  }
  return bySlug
}

/**
 * Resolve the merged `toolRestrictions` for a chat-kind enable transition.
 * Returns the current map unchanged for internal agents, plain re-saves, or when
 * no identity-scoped binding can be auto-created. Reads the installed-apps cache
 * and var registry once (outside the tx) so the write stays a pure merge.
 */
async function resolveAutoRestrictions(
  organizationId: string,
  row: AgentToolsetRow,
  nextToolsets: ToolsetEntry[]
): Promise<ToolRestrictionMap> {
  if (row.kind !== 'chat') return row.toolRestrictions

  const toolsBySlug = await buildToolsBySlug(organizationId)
  if (toolsBySlug.size === 0) return row.toolRestrictions

  const registry = await buildRestrictionVarRegistry(organizationId)
  const suggestedVars: string[] = []
  for (const tools of toolsBySlug.values()) {
    for (const tool of tools) {
      for (const input of tool.identityScopedInputs ?? []) {
        if (input.suggestedVar) suggestedVars.push(input.suggestedVar)
      }
    }
  }
  const resolvableVarIds = buildResolvableVarIdSet(
    registry.map((v) => v.id),
    suggestedVars
  )

  return computeAutoRestrictions(
    row.kind,
    row.toolsets,
    nextToolsets,
    row.toolRestrictions,
    toolsBySlug,
    resolvableVarIds
  )
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
    const row = await loadAgentForToolsetUpdate(tx, agentId)
    const next = applyToolsetPatch(row.toolsets, patch)
    const nextAppAccounts = await clearOrphanedAppAccounts(
      organizationId,
      row.toolsets,
      next,
      row.appAccounts,
      [patch]
    )
    const nextRestrictions = await resolveAutoRestrictions(organizationId, row, next)
    await tx
      .update(schema.Agent)
      .set({
        toolsets: next,
        ...(nextAppAccounts === row.appAccounts ? {} : { appAccounts: nextAppAccounts }),
        ...(nextRestrictions === row.toolRestrictions
          ? {}
          : { toolRestrictions: nextRestrictions }),
        updatedAt: new Date(),
      })
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
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
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
    const row = await loadAgentForToolsetUpdate(tx, agentId)
    let next = row.toolsets
    for (const patch of patches) {
      next = applyToolsetPatch(next, patch)
    }
    const nextAppAccounts = await clearOrphanedAppAccounts(
      organizationId,
      row.toolsets,
      next,
      row.appAccounts,
      patches
    )
    const nextRestrictions = await resolveAutoRestrictions(organizationId, row, next)
    await tx
      .update(schema.Agent)
      .set({
        toolsets: next,
        ...(nextAppAccounts === row.appAccounts ? {} : { appAccounts: nextAppAccounts }),
        ...(nextRestrictions === row.toolRestrictions
          ? {}
          : { toolRestrictions: nextRestrictions }),
        updatedAt: new Date(),
      })
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
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
}
