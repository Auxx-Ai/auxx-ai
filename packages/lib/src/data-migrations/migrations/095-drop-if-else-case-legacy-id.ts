// packages/lib/src/data-migrations/migrations/095-drop-if-else-case-legacy-id.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { asc, eq, gt } from 'drizzle-orm'
import type { WorkflowGraph } from '../../workflows/template-graph-transformer'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-095')

/** Rows scanned per page. Graphs are jsonb documents, so keep the page small. */
const BATCH_SIZE = 200

/**
 * Drop the retired node-local `id` from every `if-else` case in ONE graph.
 *
 * Mutates `graph` in place and returns the number of NODES whose cases changed —
 * `0` means there is nothing to persist, which is what makes a second pass a
 * no-op rather than a rewrite.
 *
 * The only key ever removed is `cases[].id`. `case_id` — the branch handle every
 * edge's `sourceHandle` points at — is neither read nor written, and `graph.edges`
 * is never looked at: this function is structurally incapable of moving a handle.
 *
 * Exported for the unit test — pure, no DB.
 */
export function dropLegacyCaseIdsInGraph(graph: WorkflowGraph): number {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) return 0

  let touched = 0
  for (const node of graph.nodes) {
    if (node?.data?.type !== 'if-else') continue
    const cases = node.data.cases
    if (!Array.isArray(cases)) continue

    let nodeChanged = false
    for (const caseItem of cases) {
      if (caseItem && typeof caseItem === 'object' && 'id' in caseItem) {
        delete (caseItem as Record<string, unknown>).id
        nodeChanged = true
      }
    }
    if (nodeChanged) touched++
  }

  return touched
}

/** Per-column tallies, so the log line says which of the three actually moved. */
interface ColumnSummary {
  scanned: number
  rewritten: number
  nodesRewritten: number
}

const emptySummary = (): ColumnSummary => ({ scanned: 0, rewritten: 0, nodesRewritten: 0 })

/**
 * Retire `cases[].id` from every stored if-else node
 * (`plans/kopilot/workflow/28-case-identity-and-manifest-purity.md` §3.1a).
 *
 * **Why the key goes away.** An if-else case carried two identifiers and only one
 * of them was an address. `case_id` IS the branch handle: it is what `node.tsx`
 * renders, what an edge stores as `sourceHandle`, what the engine returns as
 * `outputHandle` and what `resolveConnectionSpec` resolves a `branch` to. `id`
 * addressed nothing, was validated by nothing, and was read by exactly two
 * node-local sites. Worse, 47 of 53 stored cases parked the *readable* name in
 * `id` (`case_has_order`) while the actual address read `true` — so the more
 * address-looking of the two was the one that routed nothing.
 *
 * **Why this is migrated rather than left to rot.** Retiring a stored key
 * normally means adding it to `NON_CONFIG_KEYS` (`graph-edit/read.ts`) and
 * letting the data sit — that is how `inputNodes` and `description` were retired.
 * That mechanism is unavailable here: `buildNodeSummary` applies the set over
 * `Object.entries(node.data)`, TOP LEVEL ONLY, and `cases[].id` is one level
 * down. Left in place it reaches the agent-facing `config` on every `get_node` of
 * a legacy node — echoing exactly the two-id confusion the schema change deletes,
 * at a moment when `describe_node_type` no longer documents `id` at all and
 * `patch-config` does no schema-based path validation, so the model could write
 * to it too.
 *
 * **Scope.** Three jsonb graph columns:
 * - `Workflow.graph` — the draft AND every published version are independent rows
 *   in that one table;
 * - `WorkflowTemplate.graph` — admin-authored DB templates (the bundled
 *   `*.template.json` files are never written to the DB and were re-authored in
 *   the same change);
 * - `WorkflowRun.graph` — the frozen graph a run executed against. Historical, but
 *   it is what the run-detail trace renders from, so it gets the same shape.
 *
 * Each column is its own loop with its own cursor: three tables means three
 * independent idempotency guarantees, and a shared cursor would couple them.
 *
 * **Safety.** Read-modify-write on the RAW column, never through `hydrateGraph` —
 * hydration re-adds derived fields (`node.type`, `edge.data.sourceType`, filled
 * handles) and would re-fatten every row plan 23's canonicalization slimmed.
 * Nothing but `cases[].id` is touched; edges are never read or written.
 *
 * **`updatedAt` is deliberately not written.** Nothing reads the key being
 * dropped, so no consumer's view of the workflow changes, and stamping "last
 * edited" across the fleet would report a migration as a user edit. `Workflow`
 * and `WorkflowRun` therefore keep theirs; `WorkflowTemplate.updatedAt` carries
 * `$onUpdate`, so Drizzle stamps it whatever this code does — an admin-template
 * row is not a "last edited by you" surface, so that is left as it is rather
 * than fought with raw SQL. The save-path CAS token (`graphHash`) is derived
 * from the stored graph at read time and is never persisted, so there is no
 * stale token to invalidate — a builder tab left open across the migration
 * simply re-reads.
 *
 * **Idempotent.** A row is only written when {@link dropLegacyCaseIdsInGraph}
 * reports a node it actually changed, and after one pass no case carries the key,
 * so a second run issues zero UPDATEs against any of the three columns.
 *
 * Raw Drizzle on purpose — the `ensure*` helpers are for entity migrations.
 */
export const migration095DropIfElseCaseLegacyId: DataMigrationDef = {
  id: '095-drop-if-else-case-legacy-id',
  description: 'Drop the retired cases[].id from stored if-else nodes (case_id is the sole id)',
  async run(db: Database): Promise<void> {
    const workflows = emptySummary()
    const templates = emptySummary()
    const runs = emptySummary()

    // ── Workflow.graph ────────────────────────────────────────────────────────
    let workflowCursor = ''
    for (;;) {
      const rows = await db
        .select({ id: schema.Workflow.id, graph: schema.Workflow.graph })
        .from(schema.Workflow)
        .where(gt(schema.Workflow.id, workflowCursor))
        .orderBy(asc(schema.Workflow.id))
        .limit(BATCH_SIZE)

      if (rows.length === 0) break

      for (const row of rows) {
        workflows.scanned++
        workflowCursor = row.id

        if (!row.graph || typeof row.graph !== 'object') continue
        const graph = row.graph as unknown as WorkflowGraph

        const touched = dropLegacyCaseIdsInGraph(graph)
        if (touched === 0) continue

        await db
          .update(schema.Workflow)
          .set({ graph: graph as any })
          .where(eq(schema.Workflow.id, row.id))

        workflows.rewritten++
        workflows.nodesRewritten += touched
        logger.info('Dropped legacy if-else case ids', {
          table: 'Workflow',
          rowId: row.id,
          nodesTouched: touched,
        })
      }

      if (rows.length < BATCH_SIZE) break
    }

    // ── WorkflowTemplate.graph ────────────────────────────────────────────────
    let templateCursor = ''
    for (;;) {
      const rows = await db
        .select({ id: schema.WorkflowTemplate.id, graph: schema.WorkflowTemplate.graph })
        .from(schema.WorkflowTemplate)
        .where(gt(schema.WorkflowTemplate.id, templateCursor))
        .orderBy(asc(schema.WorkflowTemplate.id))
        .limit(BATCH_SIZE)

      if (rows.length === 0) break

      for (const row of rows) {
        templates.scanned++
        templateCursor = row.id

        if (!row.graph || typeof row.graph !== 'object') continue
        const graph = row.graph as unknown as WorkflowGraph

        const touched = dropLegacyCaseIdsInGraph(graph)
        if (touched === 0) continue

        await db
          .update(schema.WorkflowTemplate)
          .set({ graph: graph as any })
          .where(eq(schema.WorkflowTemplate.id, row.id))

        templates.rewritten++
        templates.nodesRewritten += touched
        logger.info('Dropped legacy if-else case ids', {
          table: 'WorkflowTemplate',
          rowId: row.id,
          nodesTouched: touched,
        })
      }

      if (rows.length < BATCH_SIZE) break
    }

    // ── WorkflowRun.graph ─────────────────────────────────────────────────────
    let runCursor = ''
    for (;;) {
      const rows = await db
        .select({ id: schema.WorkflowRun.id, graph: schema.WorkflowRun.graph })
        .from(schema.WorkflowRun)
        .where(gt(schema.WorkflowRun.id, runCursor))
        .orderBy(asc(schema.WorkflowRun.id))
        .limit(BATCH_SIZE)

      if (rows.length === 0) break

      for (const row of rows) {
        runs.scanned++
        runCursor = row.id

        if (!row.graph || typeof row.graph !== 'object') continue
        const graph = row.graph as unknown as WorkflowGraph

        const touched = dropLegacyCaseIdsInGraph(graph)
        if (touched === 0) continue

        await db
          .update(schema.WorkflowRun)
          .set({ graph: graph as any })
          .where(eq(schema.WorkflowRun.id, row.id))

        runs.rewritten++
        runs.nodesRewritten += touched
        logger.info('Dropped legacy if-else case ids', {
          table: 'WorkflowRun',
          rowId: row.id,
          nodesTouched: touched,
        })
      }

      if (rows.length < BATCH_SIZE) break
    }

    logger.info('if-else legacy case id drop complete', { workflows, templates, runs })
  },
}
