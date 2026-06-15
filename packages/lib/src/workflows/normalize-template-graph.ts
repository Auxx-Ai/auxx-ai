// packages/lib/src/workflows/normalize-template-graph.ts

import { textToDoc } from '../tiptap/text-to-doc'
import type { WorkflowGraph } from './template-graph-transformer'

/** A single AI-node prompt message in either the legacy or current shape. */
interface PromptTemplateEntry {
  role?: string
  json?: unknown
  text?: string
}

/** True when `json` is a non-empty Tiptap document. */
function isTiptapDoc(json: unknown): boolean {
  return !!json && typeof json === 'object' && (json as { type?: unknown }).type === 'doc'
}

/**
 * Normalize `ai` node `prompt_template` entries to the current `{ role, json }`
 * Tiptap-doc shape.
 *
 * The workflow AI-node editor reads `prompt_template[].json` only. Templates
 * authored in the legacy `{ role, text }` form (a `{{variable}}` string) would
 * render blank, so this converts each legacy entry with `textToDoc(..., {
 * parseVariables: true })`. Entries that already carry a Tiptap doc are left
 * untouched, making this idempotent and safe to run at every read-for-use point
 * (file registry load, admin save, template install).
 *
 * Only `ai` nodes are touched — `information-extractor`, `answer`, and
 * `text-classifier` still use plain `{{variable}}` strings by design.
 *
 * Returns a deep clone; the input graph is never mutated.
 */
export function normalizeTemplateGraph<T extends WorkflowGraph | null | undefined>(graph: T): T {
  if (!graph || !Array.isArray(graph.nodes)) return graph

  const cloned = structuredClone(graph) as WorkflowGraph
  for (const node of cloned.nodes) {
    if (node?.data?.type !== 'ai') continue
    const prompts = node.data.prompt_template
    if (!Array.isArray(prompts)) continue

    node.data.prompt_template = prompts.map((entry: PromptTemplateEntry) => {
      if (entry && isTiptapDoc(entry.json)) return entry
      return {
        role: entry?.role ?? 'system',
        json: textToDoc(entry?.text ?? '', { parseVariables: true }),
      }
    })
  }

  return cloned as T
}
