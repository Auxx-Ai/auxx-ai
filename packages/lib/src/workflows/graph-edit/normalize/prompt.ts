// packages/lib/src/workflows/graph-edit/normalize/prompt.ts

/**
 * Prompt normalization for ai-style nodes (`03-graph-edit-service.md` §3
 * row 4) — pure, browser-safe.
 *
 * The `ai` node persists `prompt_template: Array<{ role, json: TiptapDoc }>`;
 * a model authors plain strings with `{{…}}` refs. This converts the friendly
 * forms through the EXISTING machinery — `textToDoc({ parseVariables: true })`
 * via `normalizeTemplateGraph` (`../../normalize-template-graph`), the same
 * pass template install already runs — rather than re-implementing the
 * string → Tiptap conversion.
 *
 * Only `ai` is touched: `information-extractor`, `answer` and
 * `text-classifier` use plain `{{variable}}` strings by design
 * (`normalize-template-graph.ts` documents the same boundary).
 */

import { normalizeTemplateGraph } from '../../normalize-template-graph'

/** Friendly prompt entry shapes accepted from an agent. */
type FriendlyPromptEntry = string | { role?: string; text?: string; json?: unknown }

/**
 * Normalize an `ai` node config's prompt to the persisted
 * `prompt_template: [{ role, json }]` shape. Accepted friendly forms:
 *
 * - `prompt: "Summarize {{Find Contact.body}}"` → a single system entry
 * - `prompt_template: ["...", { role, text }, { role, json }]` — bare strings
 *   become system entries, `{ role, text }` entries convert, Tiptap-doc
 *   entries pass through untouched (idempotent).
 *
 * Variable refs inside the text should already be in persisted `{{nodeId.…}}`
 * form (run `normalizeFriendlyRefs` first) — `textToDoc` turns each `{{…}}`
 * span into a `variable-node` chip verbatim.
 *
 * Non-`ai` node types and configs without prompt keys pass through unchanged.
 * Returns a clone; `config` is never mutated.
 */
export function normalizeAiPromptConfig<T extends Record<string, unknown>>(
  nodeType: string,
  config: T
): T {
  if (nodeType !== 'ai') return config
  const hasFriendlyPrompt = typeof config.prompt === 'string'
  if (!hasFriendlyPrompt && !Array.isArray(config.prompt_template)) return config

  const friendlyEntries: FriendlyPromptEntry[] = hasFriendlyPrompt
    ? [{ role: 'system', text: config.prompt as string }]
    : (config.prompt_template as FriendlyPromptEntry[])

  // Bare strings → { role: 'system', text } so `normalizeTemplateGraph` (which
  // reads `entry.text`) sees them; everything else passes through for it to
  // convert-or-keep.
  const prepared = friendlyEntries.map((entry) =>
    typeof entry === 'string' ? { role: 'system', text: entry } : entry
  )

  // Reuse the template-install pass verbatim by wrapping the prompt as a
  // one-node graph — it converts `{ role, text }` via
  // `textToDoc({ parseVariables: true })` and leaves Tiptap docs untouched.
  const normalized = normalizeTemplateGraph({
    nodes: [
      {
        id: 'n',
        type: 'standard',
        position: { x: 0, y: 0 },
        data: { type: 'ai', prompt_template: prepared },
      },
    ],
    edges: [],
  })

  const result: Record<string, unknown> = { ...config }
  delete result.prompt
  result.prompt_template = normalized.nodes[0]!.data.prompt_template
  return result as T
}
