// apps/web/src/server/api/workflow-template-resolver.ts

import { getFileTemplateById, isFileTemplateId, normalizeTemplateGraph } from '@auxx/lib/workflows'
import { getTemplateById, type WorkflowTemplateDetail } from '@auxx/services/workflow-templates'

/** A resolved template, tagged with its origin so callers can gate edits. */
export type ResolvedTemplate = WorkflowTemplateDetail & { source: 'file' | 'admin' }

/**
 * Resolve a workflow template by id from either the bundled file registry or the
 * database, with AI-node prompts normalized to the editor's `{ role, json }` shape.
 *
 * File templates (id prefixed `file:`) are normalized at registry load. DB rows
 * are normalized here so legacy `{ role, text }` prompts self-heal on read.
 *
 * @param id - File template id (`file:<slug>`) or DB row id.
 * @returns The resolved template, or null if not found.
 */
export async function resolveTemplateById(id: string): Promise<ResolvedTemplate | null> {
  if (isFileTemplateId(id)) {
    return getFileTemplateById(id) ?? null
  }

  const result = await getTemplateById(id)
  if (result.isErr() || !result.value) return null

  return {
    ...result.value,
    graph: normalizeTemplateGraph(result.value.graph),
    source: 'admin',
  }
}
