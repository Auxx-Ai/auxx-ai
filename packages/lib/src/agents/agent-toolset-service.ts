// packages/lib/src/agents/agent-toolset-service.ts

import {
  type AgentKind,
  type AppAccountBinding,
  type Database,
  database as defaultDb,
  schema,
  type ToolsetEntry,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { NotFoundError } from '../errors'
import { getRealtimeService, publishAgentUpdated } from '../realtime'
import type { AgentToolsetConfig } from './agent-toolset-types'

/**
 * Mark the draft dirty, but only when an active version exists to be dirty
 * against (pre-setup drafts have no published baseline). Reused by every
 * toolset write below. See plans/agents/agent-versions/build-plan.md §2.1.
 */
const MARK_DIRTY_IF_PUBLISHED = sql`${schema.Agent.activeVersionId} is not null`

import { getOrgToolsetCatalog } from './toolset-catalog'

const logger = createScopedLogger('agent-toolset-service')

/**
 * Patch shape applied to a single `(agentId, toolsetSlug)` entry. Both
 * `enabled` and `enabledTools` are independently optional so callers can
 * patch just what changed.
 */
export interface AgentToolsetPatch {
  slug: string
  enabled?: boolean
  /** Per-tool allow-list (full replace). Implicit toolsets only — see `AgentToolsetConfig`. */
  enabledTools?: string[]
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
    if (patch.enabledTools !== undefined) config.enabledTools = patch.enabledTools
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
  if (patch.enabledTools !== undefined) {
    nextConfig.enabledTools = patch.enabledTools
  }
  const next: ToolsetEntry = {
    ...existing,
    config: nextConfig,
    enabled: patch.enabled ?? existing.enabled,
    source: existing.source === 'auto_default' ? 'manual' : existing.source,
  }
  return current.map((t, i) => (i === idx ? next : t))
}

/**
 * Safety net for the allow-list invariant: an **enabled implicit** entry (MCP
 * server or ungrouped app tools) must always carry an explicit `enabledTools`
 * list — an absent list means pass-all at runtime, which would silently arm
 * tools the server ships later (the exact hole the allow-list exists to
 * close). UI writers send the snapshot themselves (so their optimistic cache
 * matches); this catches every other caller (Kopilot, server-originated
 * enables). Only entries touched by `patches` are considered. Returns the
 * same array reference when nothing needs fixing. See
 * plans/mcp/v4/tool-first-catalog.md ("Row toggle = snapshot").
 */
async function ensureImplicitSnapshots(
  organizationId: string,
  next: ToolsetEntry[],
  patches: AgentToolsetPatch[]
): Promise<ToolsetEntry[]> {
  const patchedSlugs = new Set(patches.map((p) => p.slug))
  const needsSnapshot = (t: ToolsetEntry) =>
    patchedSlugs.has(t.slug) &&
    t.enabled &&
    !Array.isArray((t.config as AgentToolsetConfig | undefined)?.enabledTools)
  if (!next.some(needsSnapshot)) return next

  const catalog = await getOrgToolsetCatalog(organizationId)
  const catalogBySlug = new Map(catalog.map((c) => [c.slug, c]))
  let changed = false
  const result = next.map((t) => {
    if (!needsSnapshot(t)) return t
    const entry = catalogBySlug.get(t.slug)
    if (!entry?.implicit) return t
    changed = true
    return {
      ...t,
      config: {
        ...(t.config as AgentToolsetConfig),
        enabledTools: entry.tools.map((tool) => tool.name),
      },
    }
  })
  return changed ? result : next
}

interface AgentToolsetRow {
  kind: AgentKind
  toolsets: ToolsetEntry[]
  appAccounts: Record<string, AppAccountBinding>
}

/**
 * Load + lock the agent row for a toolset write. The `organizationId` predicate
 * is the tenant check for every caller below: a foreign-org `agentId` matches no
 * row and throws a plain not-found (never revealing the id exists elsewhere),
 * aborting the transaction before any UPDATE runs.
 */
async function loadAgentForToolsetUpdate(
  tx: Transaction,
  organizationId: string,
  agentId: string
): Promise<AgentToolsetRow> {
  const [row] = await tx
    .select({
      kind: schema.Agent.kind,
      toolsets: schema.Agent.toolsets,
      appAccounts: schema.Agent.appAccounts,
    })
    .from(schema.Agent)
    .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
    .for('update')
    .limit(1)
  if (!row) throw new NotFoundError(`Agent not found: ${agentId}`)
  return {
    kind: row.kind,
    toolsets: row.toolsets ?? [],
    appAccounts: row.appAccounts ?? {},
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
 * Update one toolset entry on an agent. Read-modify-write of `Agent.toolsets`
 * under a row lock so concurrent autosaves don't drop edits.
 *
 * No restriction auto-create: v8 tool bindings are intrinsic to the tool
 * (author `inputBindings`), so enabling a toolset yields its scoped behavior
 * with zero extra writes. See plans/chat/v8 phase-6 §1.
 *
 * `options.excludeSocketId` keeps the `agent:updated` broadcast away from the
 * originating browser so it doesn't clobber its own optimistic cache —
 * server-originated writes (no socket) still broadcast to everyone.
 */
export async function updateAgentToolset(
  organizationId: string,
  agentId: string,
  patch: AgentToolsetPatch,
  options: { excludeSocketId?: string } = {},
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadAgentForToolsetUpdate(tx, organizationId, agentId)
    const next = await ensureImplicitSnapshots(
      organizationId,
      applyToolsetPatch(row.toolsets, patch),
      [patch]
    )
    const nextAppAccounts = await clearOrphanedAppAccounts(
      organizationId,
      row.toolsets,
      next,
      row.appAccounts,
      [patch]
    )
    await tx
      .update(schema.Agent)
      .set({
        toolsets: next,
        ...(nextAppAccounts === row.appAccounts ? {} : { appAccounts: nextAppAccounts }),
        hasUnpublishedChanges: MARK_DIRTY_IF_PUBLISHED,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
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
  await publishAgentUpdated(
    getRealtimeService(),
    organizationId,
    { agentId },
    {
      excludeSocketId: options.excludeSocketId,
    }
  )
}

/**
 * Apply many toolset patches for an agent in one transaction. Entries not in
 * the patch list are left untouched — callers send the full set they want to
 * enable, plus explicit `enabled: false` for ones they unchecked.
 *
 * `options.excludeSocketId`: see {@link updateAgentToolset}.
 */
export async function batchUpdateAgentToolsets(
  organizationId: string,
  agentId: string,
  patches: AgentToolsetPatch[],
  options: { excludeSocketId?: string } = {},
  db: Database = defaultDb as Database
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadAgentForToolsetUpdate(tx, organizationId, agentId)
    let next = row.toolsets
    for (const patch of patches) {
      next = applyToolsetPatch(next, patch)
    }
    next = await ensureImplicitSnapshots(organizationId, next, patches)
    const nextAppAccounts = await clearOrphanedAppAccounts(
      organizationId,
      row.toolsets,
      next,
      row.appAccounts,
      patches
    )
    await tx
      .update(schema.Agent)
      .set({
        toolsets: next,
        ...(nextAppAccounts === row.appAccounts ? {} : { appAccounts: nextAppAccounts }),
        hasUnpublishedChanges: MARK_DIRTY_IF_PUBLISHED,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
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
  await publishAgentUpdated(
    getRealtimeService(),
    organizationId,
    { agentId },
    {
      excludeSocketId: options.excludeSocketId,
    }
  )
}
