// packages/lib/src/ai/kopilot/prompts/resolve-instruction-references.ts

import type { FlatToolCatalogEntry, ToolsetCatalogEntry } from '../../../agents'

/**
 * Build a `references` resolver for `docToText` that turns Tiptap chip ids
 * back into LLM-readable references.
 *
 * Trigger and persona instructions are authored as Tiptap docs containing
 * inline `reference` chips (`toolset:<slug>`, `tool:<name>`, `agent:<id>`,
 * `record:<id>`, etc.). When we flatten those docs to text for the system
 * prompt, the chip needs to render as something the model can act on:
 *
 *   - `tool:<name>`     → `` `<name>` `` so the LLM can locate the tool.
 *   - `toolset:<slug>`  → backtick-quoted, comma-joined tool names within
 *                         that toolset (legacy support — picker no longer
 *                         emits these).
 *   - `agent:<id>` / `record:<id>` / `article:<id>` / `user:<id>` → the id
 *                         verbatim, backtick-quoted.
 *   - Anything else passes through verbatim, also backtick-quoted, so the
 *     model can copy it if needed.
 */
export function buildInstructionReferenceResolver(opts: {
  toolCatalog?: ReadonlyArray<FlatToolCatalogEntry>
  toolsetCatalog?: ReadonlyArray<ToolsetCatalogEntry>
}): (id: string) => string {
  const toolByName = new Map<string, FlatToolCatalogEntry>()
  for (const t of opts.toolCatalog ?? []) toolByName.set(t.name, t)

  const toolsetBySlug = new Map<string, ToolsetCatalogEntry>()
  for (const ts of opts.toolsetCatalog ?? []) toolsetBySlug.set(ts.slug, ts)

  return (id) => {
    if (!id) return ''

    if (id.startsWith('tool:')) {
      const name = id.slice('tool:'.length)
      return `\`${name}\``
    }

    if (id.startsWith('toolset:')) {
      const slug = id.slice('toolset:'.length)
      const set = toolsetBySlug.get(slug)
      if (!set || set.tools.length === 0) return `\`${slug}\``
      return set.tools.map((t) => `\`${t.name}\``).join(', ')
    }

    return `\`${id}\``
  }
}
