// packages/lib/src/data-migrations/migrations/087-knowledge-retrieval-sources.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { asc, eq, gt } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-087')
/**
 * READ-MODIFY-WRITE, AND IT MUST STAY RAW.
 *
 * This migration reads `Workflow.graph` straight from the column and writes it
 * back. It must NEVER be routed through `hydrateGraph` — hydration adds the
 * derived fields back (`node.type`, `edge.data.sourceType`, `zIndex`, filled
 * handles, ...), so a hydrate-then-write here would re-fatten every row the
 * canonicalization is removing them from. See
 * `plans/kopilot/workflow/23-graph-document-canonicalization.md` §4.2.
 */

/** Rows scanned per page (draft + every published version are separate rows). */
const BATCH_SIZE = 200

/** Must track `MAX_LIMIT` in `workflow-engine/nodes/dataset/knowledge-retrieval.ts`. */
const MAX_LIMIT = 25

interface GraphNode {
  data?: Record<string, unknown>
}

interface Graph {
  nodes?: GraphNode[]
}

/**
 * Rewrite one `knowledge-retrieval` node's data in place.
 *
 * Two independent changes, each separately guarded — a graph may already carry
 * `sources` (re-run, or authored after this shipped) and still hold a `limit`
 * above the new ceiling, so the clamp must NOT ride the reshape branch.
 *
 * Returns true if anything changed.
 *
 * Exported for the unit test — pure, no DB.
 */
export function rewriteKnowledgeRetrievalNode(data: Record<string, unknown>): boolean {
  if (data.type !== 'knowledge-retrieval') return false
  let touched = false

  // 1. datasets: [{ datasetId }] → sources: [{ kind: 'dataset', datasetId }]
  if (data.sources === undefined && Array.isArray(data.datasets)) {
    const rows = data.datasets as Array<{ datasetId?: unknown } | null>
    data.sources = rows
      .filter((r): r is { datasetId?: unknown } => Boolean(r))
      .map((r) => ({
        kind: 'dataset' as const,
        datasetId: typeof r.datasetId === 'string' ? r.datasetId : '',
      }))
    delete data.datasets
    touched = true

    // `fieldModes` keys are positional and kind-dependent:
    // `datasets.<i>.datasetId` → `sources.<i>.datasetId`. Index and field name
    // are unchanged for the dataset kind, so this is a pure prefix rename.
    const modes = data.fieldModes
    if (modes && typeof modes === 'object') {
      const m = modes as Record<string, unknown>
      for (const key of Object.keys(m)) {
        if (!key.startsWith('datasets.')) continue
        m[`sources.${key.slice('datasets.'.length)}`] = m[key]
        delete m[key]
      }
    }
  }

  // 2. Clamp `limit` to the new ceiling (K9). A stored value above it stops
  //    parsing the node's own configSchema, which fails the defaults-parse test
  //    and the node's validation at runtime. Only literal numbers are clamped —
  //    a string is a variable reference, range-checked at run time.
  if (typeof data.limit === 'number' && data.limit > MAX_LIMIT) {
    data.limit = MAX_LIMIT
    touched = true
  }

  return touched
}

/** Rewrite every knowledge-retrieval node in a graph; returns nodes touched. */
export function rewriteGraph(graph: Graph): number {
  if (!Array.isArray(graph.nodes)) return 0
  let touched = 0
  for (const node of graph.nodes) {
    if (!node?.data || typeof node.data !== 'object') continue
    if (rewriteKnowledgeRetrievalNode(node.data)) touched++
  }
  return touched
}

/**
 * Reshape `knowledge-retrieval` nodes: `datasets[]` → `sources[]`, and clamp
 * `limit` to 25.
 *
 * Before this, the node could only search RAG datasets — KB articles live in
 * managed datasets that every picker hides, so a workflow could not search the
 * knowledge base at all. `sources[]` is a union of `kb` and `dataset` rows.
 *
 * Two tables carry graphs that need it:
 *  - `Workflow.graph` — drafts + published versions.
 *  - `WorkflowTemplate.graph` — admin-created templates (bundled file templates
 *    are JSON in the repo, merged at read time, never written to the DB).
 *
 * `WorkflowRun.graph` is deliberately EXCLUDED — historical run snapshots are
 * immutable evidence and nothing re-executes them.
 *
 * Idempotent: a node already carrying `sources` skips the reshape, and the
 * clamp is a no-op once applied.
 */
export const migration087KnowledgeRetrievalSources: DataMigrationDef = {
  id: '087-knowledge-retrieval-sources',
  description:
    'Reshape knowledge-retrieval nodes from datasets[] to sources[] (kb | dataset) and clamp limit to 25',

  async run(db: Database): Promise<void> {
    let workflowsRewritten = 0
    let templatesRewritten = 0
    let nodesRewritten = 0

    // --- Workflow.graph (nullable — tolerate it) ---
    let cursor = ''
    for (;;) {
      const rows = await db
        .select({ id: schema.Workflow.id, graph: schema.Workflow.graph })
        .from(schema.Workflow)
        .where(gt(schema.Workflow.id, cursor))
        .orderBy(asc(schema.Workflow.id))
        .limit(BATCH_SIZE)

      if (rows.length === 0) break

      for (const row of rows) {
        cursor = row.id
        if (!row.graph || typeof row.graph !== 'object') continue

        const graph = row.graph as unknown as Graph
        const touched = rewriteGraph(graph)
        if (touched === 0) continue

        await db
          .update(schema.Workflow)
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column round-trip
          .set({ graph: graph as any, updatedAt: new Date() })
          .where(eq(schema.Workflow.id, row.id))

        workflowsRewritten++
        nodesRewritten += touched
        logger.info('Reshaped knowledge-retrieval nodes', { workflowId: row.id, touched })
      }

      if (rows.length < BATCH_SIZE) break
    }

    // --- WorkflowTemplate.graph ---
    cursor = ''
    for (;;) {
      const rows = await db
        .select({ id: schema.WorkflowTemplate.id, graph: schema.WorkflowTemplate.graph })
        .from(schema.WorkflowTemplate)
        .where(gt(schema.WorkflowTemplate.id, cursor))
        .orderBy(asc(schema.WorkflowTemplate.id))
        .limit(BATCH_SIZE)

      if (rows.length === 0) break

      for (const row of rows) {
        cursor = row.id
        if (!row.graph || typeof row.graph !== 'object') continue

        const graph = row.graph as unknown as Graph
        const touched = rewriteGraph(graph)
        if (touched === 0) continue

        await db
          .update(schema.WorkflowTemplate)
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column round-trip
          .set({ graph: graph as any, updatedAt: new Date() })
          .where(eq(schema.WorkflowTemplate.id, row.id))

        templatesRewritten++
        nodesRewritten += touched
        logger.info('Reshaped knowledge-retrieval nodes in template', {
          templateId: row.id,
          touched,
        })
      }

      if (rows.length < BATCH_SIZE) break
    }

    logger.info('knowledge-retrieval sources migration done', {
      workflowsRewritten,
      templatesRewritten,
      nodesRewritten,
    })
  },
}
