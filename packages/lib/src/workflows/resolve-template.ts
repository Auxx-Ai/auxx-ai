// packages/lib/src/workflows/resolve-template.ts

import { getTemplateById, type WorkflowTemplateDetail } from '@auxx/services/workflow-templates'
import { type GraphDocument, hydrateGraph } from '../workflow-engine/catalog/graph-hydration'
import { HYDRATION_OPTIONS } from '../workflow-engine/catalog/hydration-policy'
import { normalizeTemplateGraph } from './normalize-template-graph'
import { getFileTemplateById, isFileTemplateId } from './templates'

/** A resolved template, tagged with its origin so callers can gate edits. */
export type ResolvedTemplate = WorkflowTemplateDetail & { source: 'file' | 'admin' }

/**
 * Resolve a workflow template by id from either the bundled file registry or
 * the database, with AI-node prompts normalized to the editor's
 * `{ role, json }` shape. Moved from
 * `apps/web/src/server/api/workflow-template-resolver.ts` (which re-exports
 * it) so headless callers — graph-edit's `applyTemplate` — share the same
 * file + admin merge as the create-from-template router path.
 *
 * File templates (id prefixed `file:`) are normalized at registry load. DB
 * rows are normalized here so legacy `{ role, text }` prompts self-heal on
 * read.
 *
 * THE single template read boundary (plan 23 §4.2) — both doors hydrate here,
 * so the install path and the preview see one shape. It matters most for the
 * bundled files: nothing validates the shape of a template write, and a
 * super-admin can export a builder-fat graph straight into a
 * `*.template.json`.
 *
 * @param id - File template id (`file:<slug>`) or DB row id.
 * @returns The resolved template, or null if not found.
 */
export async function resolveTemplateById(id: string): Promise<ResolvedTemplate | null> {
  if (isFileTemplateId(id)) {
    const template = getFileTemplateById(id)
    if (!template) return null
    return { ...template, graph: hydrate(template.graph) }
  }

  const result = await getTemplateById(id)
  if (result.isErr() || !result.value) return null

  return {
    ...result.value,
    graph: hydrate(normalizeTemplateGraph(result.value.graph)),
    source: 'admin',
  }
}

/** Hydrate a template graph, tolerating the `unknown` the column/registry hands over. */
function hydrate(graph: unknown): WorkflowTemplateDetail['graph'] {
  if (graph == null || typeof graph !== 'object') return graph as WorkflowTemplateDetail['graph']
  return hydrateGraph(graph as GraphDocument, HYDRATION_OPTIONS) as WorkflowTemplateDetail['graph']
}
