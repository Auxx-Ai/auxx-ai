// packages/lib/src/workflow-templates/canonicalize.ts

import { dehydrateGraph, type GraphDocument } from '../workflow-engine/catalog/graph-hydration'
import { DEHYDRATION_OPTIONS } from '../workflow-engine/catalog/hydration-policy'

/**
 * Canonicalize a template graph on its way into `WorkflowTemplate.graph`.
 *
 * This is the template half of what `persistDraft` does for `Workflow.graph`
 * (plan 23 §4.2): every read boundary hydrates, so every write boundary must
 * dehydrate under the paired policy or the derived keys hydration added get
 * stored as if an author had written them.
 *
 * It is not hypothetical. `resolveTemplateById` hydrates, the admin editor
 * renders THAT graph into its JSON textarea, and Save posts the textarea back —
 * so before this existed, merely opening a clean template and saving it wrote
 * `node.type: 'standard'`, `edge.data.sourceType`/`targetType`, filled handles,
 * `selected`, `width`/`height` and a 16-digit-zoom viewport into the row. The
 * same graph is what "Export to file" serialises into a `*.template.json` a
 * developer then commits, which is how a fat blob becomes permanent.
 *
 * Dehydration is idempotent, so running it on an already-canonical graph is a
 * no-op — that is what makes it safe to apply unconditionally at every writer.
 *
 * @param graph - A graph in any shape: hydrated, canonical, or absent.
 * @returns The canonical stored form, or the input untouched when it is not an
 *   object (a null column, or a caller passing `undefined` to mean "leave it").
 */
export function canonicalizeTemplateGraph<T>(graph: T): T {
  if (graph == null || typeof graph !== 'object') return graph
  return dehydrateGraph(graph as unknown as GraphDocument, DEHYDRATION_OPTIONS) as unknown as T
}
