// packages/lib/src/data-migrations/migrations/083-find-many-plural-to-id-refs.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { asc, eq, gt } from 'drizzle-orm'
import { RESOURCE_TABLE_MAP } from '../../resources/registry'
import type { WorkflowGraph } from '../../workflows/template-graph-transformer'
import { rewriteVariableRefs } from '../../workflows/variable-ref-rewriter'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-083')

/** `Workflow` rows scanned per page (draft + every published version are separate rows). */
const BATCH_SIZE = 200

/** What a findMany node's stored `resourceType` resolves to. */
interface ResolvedResource {
  id: string
  plural: string
}

/**
 * Every key a find node's `resourceType` config can be stored under, mapped to
 * the resource it identifies. Mirrors the three-way match
 * `resolveCanonicalResource`/`findCachedResource` do at runtime (id | entityType
 * | apiSlug) — see `find.ts:544-559` and
 * `plans/kopilot/workflow/10-variable-resolution-deep-dive.md` §1's
 * "alias-tolerant keying" note.
 *
 * Exported for the unit test — pure, no DB.
 */
export function buildStaticResourceMap(): Map<string, ResolvedResource> {
  const map = new Map<string, ResolvedResource>()
  for (const table of Object.values(RESOURCE_TABLE_MAP)) {
    const entry: ResolvedResource = { id: table.id, plural: table.plural }
    map.set(table.id, entry)
    if (table.apiSlug) map.set(table.apiSlug, entry)
  }
  return map
}

/**
 * Extend a resource map with one organization's `EntityDefinition` rows —
 * covers custom entities AND the entity-def-backed system types (contact/
 * ticket/…, `type: 'custom'` per the deep-dive doc's tier correction, §1).
 *
 * Exported for the unit test — pure, no DB (takes already-fetched rows).
 */
export function buildOrgResourceMap(
  staticMap: Map<string, ResolvedResource>,
  entityDefs: Array<{ id: string; plural: string; entityType: string | null; apiSlug: string }>
): Map<string, ResolvedResource> {
  const map = new Map(staticMap)
  for (const def of entityDefs) {
    const entry: ResolvedResource = { id: def.id, plural: def.plural }
    map.set(def.id, entry)
    if (def.entityType) map.set(def.entityType, entry)
    if (def.apiSlug) map.set(def.apiSlug, entry)
  }
  return map
}

/**
 * Rewrite one variable path if it starts with `<findNodeId>.<oldKey>` for one
 * of `rewrites` — string-prefix match, NOT `firstPathSegment`, because
 * `oldKey` (a lowercased plural label) can itself contain spaces
 * ('knowledge bases') that `rewriteVariableRefs`' bare-string node-id gate
 * doesn't split on. Every `rewrites` entry targets a DIFFERENT node id, so at
 * most one can ever match a given path — never a blanket plural-string
 * replace (the design's explicit constraint).
 */
function rewritePluralPrefix(
  path: string,
  rewrites: Array<{ findNodeId: string; oldKey: string; newKey: string }>
): string {
  for (const { findNodeId, oldKey, newKey } of rewrites) {
    const prefix = `${findNodeId}.${oldKey}`
    if (path === prefix) return `${findNodeId}.${newKey}`
    if (path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)) {
      return `${findNodeId}.${newKey}${path.slice(prefix.length)}`
    }
  }
  return path
}

/**
 * Rewrite every findMany node's plural-keyed `{{…}}`/bare variable ref in one
 * workflow graph onto the canonical `resource.id` key. Mutates `graph` (and
 * the `node.data` objects inside it) in place and returns the number of nodes
 * whose data actually changed — `0` means nothing to persist.
 *
 * IDEMPOTENT by construction: once a path has been rewritten it starts with
 * `<findNodeId>.<newKey>`, which no longer matches the `<findNodeId>.<oldKey>`
 * prefix `rewritePluralPrefix` looks for, so a second pass is a no-op.
 *
 * Exported for the unit test — pure, no DB.
 */
export function rewriteFindManyRefsInGraph(
  graph: WorkflowGraph,
  resourceMap: Map<string, ResolvedResource>
): number {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) return 0

  const rewrites: Array<{ findNodeId: string; oldKey: string; newKey: string }> = []
  for (const node of graph.nodes) {
    if (node?.data?.type !== 'find' || node.data.findMode !== 'findMany') continue
    const resourceType = node.data.resourceType
    if (typeof resourceType !== 'string' || !resourceType) continue

    const resolved = resourceMap.get(resourceType)
    if (!resolved) continue

    const oldKey = resolved.plural.toLowerCase()
    const newKey = resolved.id
    if (oldKey === newKey) continue // nothing to rewrite — same string either way

    rewrites.push({ findNodeId: node.id, oldKey, newKey })
  }

  if (rewrites.length === 0) return 0

  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  let touched = 0
  for (const node of graph.nodes) {
    if (!node.data || typeof node.data !== 'object') continue
    const before = JSON.stringify(node.data)
    rewriteVariableRefs(node.data, nodeIds, (path) => rewritePluralPrefix(path, rewrites))
    if (JSON.stringify(node.data) !== before) touched++
  }

  return touched
}

/**
 * Rewrite `{{<findNodeId>.<plural>…}}` references (and their bare-string
 * equivalents) left over from before the findMany id-keying fix onto the
 * canonical `{{<findNodeId>.<resource.id>…}}` form.
 *
 * **Why.** `find.ts`'s findMany lanes used to key their result array on
 * `resource.plural.toLowerCase()` — a USER-EDITABLE string (entity settings)
 * — so renaming an entity silently broke every stored `{{node.<plural>…}}`
 * reference (plans/kopilot/workflow/10-variable-resolution-deep-dive.md §3.1,
 * the doc's headline bug). The engine fix (§10 option A+C, §10b step 5) now
 * dual-writes the array under BOTH the canonical `resource.id` key and the
 * legacy plural key, so nothing is broken by NOT running this migration — but
 * every graph left un-migrated carries a stale key forever, one entity rename
 * away from breaking again. This migration is the one-shot cleanup that lets
 * the legacy dual-write eventually retire.
 *
 * **Scope.** Every row in `Workflow` — the draft AND every published version
 * are independent rows sharing that one table (`WorkflowApp.workflowId` /
 * `.draftWorkflowId` each point at a `Workflow` row; `packages/database/src/db/
 * schema/workflow.ts`'s `graph` jsonb column holds the node graph). Workflow
 * TEMPLATES (`WorkflowTemplate`) are deliberately NOT walked: templates store
 * `@entity:`/`@field:` placeholder tokens, not literal resource keys — the
 * literal plural string this migration hunts for can only exist in an
 * installed, org-owned workflow.
 *
 * **Resolution.** Per organization: entity-def-backed resources (custom
 * entities + contact/ticket/…) come from that org's `EntityDefinition` rows;
 * static tier-A resources (thread/message/kb/…) come from the global
 * `RESOURCE_TABLE_MAP` — same three-way match (id | entityType | apiSlug) the
 * engine uses to canonicalize `resourceType` at runtime, so a node's stored
 * config (whichever of the three it happens to hold) resolves the same way
 * here as it would live.
 *
 * **Idempotent.** See `rewriteFindManyRefsInGraph`'s docblock — a graph with
 * nothing left to rewrite is skipped without a write.
 *
 * **Self-contained.** Raw Drizzle, no org-cache reads (a migration must not
 * depend on cache state that may be cold, stale, or shaped differently by the
 * time this runs) — `EntityDefinition` is read straight from the DB per org,
 * cached only within this run.
 */
export const migration083FindManyPluralToIdRefs: DataMigrationDef = {
  id: '083-find-many-plural-to-id-refs',
  description: 'Rewrite findMany {{node.<plural>…}} refs onto the canonical {{node.<id>…}} form',
  async run(db: Database): Promise<void> {
    const staticResources = buildStaticResourceMap()
    const orgResourceMapCache = new Map<string, Map<string, ResolvedResource>>()

    async function getOrgResourceMap(orgId: string): Promise<Map<string, ResolvedResource>> {
      const cached = orgResourceMapCache.get(orgId)
      if (cached) return cached

      const defs = await db
        .select({
          id: schema.EntityDefinition.id,
          plural: schema.EntityDefinition.plural,
          entityType: schema.EntityDefinition.entityType,
          apiSlug: schema.EntityDefinition.apiSlug,
        })
        .from(schema.EntityDefinition)
        .where(eq(schema.EntityDefinition.organizationId, orgId))

      const map = buildOrgResourceMap(staticResources, defs)
      orgResourceMapCache.set(orgId, map)
      return map
    }

    let cursor = ''
    let scanned = 0
    let graphsRewritten = 0
    let nodesRewritten = 0

    for (;;) {
      const rows = await db
        .select({
          id: schema.Workflow.id,
          organizationId: schema.Workflow.organizationId,
          graph: schema.Workflow.graph,
        })
        .from(schema.Workflow)
        .where(gt(schema.Workflow.id, cursor))
        .orderBy(asc(schema.Workflow.id))
        .limit(BATCH_SIZE)

      if (rows.length === 0) break

      for (const row of rows) {
        scanned++
        cursor = row.id

        if (!row.graph || typeof row.graph !== 'object') continue
        const graph = row.graph as unknown as WorkflowGraph
        if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) continue

        const resourceMap = await getOrgResourceMap(row.organizationId)
        const touched = rewriteFindManyRefsInGraph(graph, resourceMap)
        if (touched === 0) continue

        await db
          .update(schema.Workflow)
          .set({ graph: graph as any, updatedAt: new Date() })
          .where(eq(schema.Workflow.id, row.id))

        graphsRewritten++
        nodesRewritten += touched
        logger.info('Rewrote findMany plural refs', {
          workflowId: row.id,
          organizationId: row.organizationId,
          nodesTouched: touched,
        })
      }

      if (rows.length < BATCH_SIZE) break
    }

    logger.info('findMany plural→id ref migration done', {
      scanned,
      graphsRewritten,
      nodesRewritten,
    })
  },
}
