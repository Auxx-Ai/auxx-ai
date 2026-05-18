// packages/lib/src/agents/client.ts

/**
 * Client-safe exports from `@auxx/lib/agents`. The barrel `index.ts` pulls
 * in server-only deps (DB, capabilities); this subpath is what client
 * components should import from.
 */

export type AgentScopeMode = 'include_descendants' | 'include_one' | 'exclude'

export interface ToolCatalogEntry {
  name: string
  /** Short, human-friendly label for chips, pickers, and audit UI. */
  displayName: string
  description: string
}

/**
 * Recursive catalog node mirrored from the server. App, sub-group, and toolset
 * all share this shape; `kind` discriminates visual treatment. See
 * `toolset-catalog.ts` for the canonical shape and
 * `plans/kopilot/agents/tools/recursive-catalog-node.md` for the model.
 */
export type CatalogNode = CatalogContainerNode | CatalogToolsetNode

interface CatalogNodeBase {
  id: string
  label: string
  iconId: string | null
  color: string | null
}

export interface CatalogContainerNode extends CatalogNodeBase {
  kind: 'app' | 'subGroup'
  children: CatalogNode[]
}

export interface CatalogToolsetNode extends CatalogNodeBase {
  kind: 'toolset'
  /** Runtime slug — join key against `Agent.toolsets[*].slug`. */
  slug: string
  /** Long-form label for picker chips / reference badges. */
  fullLabel: string
  /** One-line tooltip copy shown on the leaf row's help icon. */
  description: string
  isDefault: boolean
  /** Curated for the Tool-Select dialog's "Popular tools" group. */
  isPopular: boolean
  tools: ToolCatalogEntry[]
}

/**
 * Flat per-toolset projection mirrored from the server. Used by picker
 * components that need slug-keyed lookups; the Tools tab consumes `CatalogNode`.
 */
export interface FlatToolsetCatalogEntry {
  /** Toolset slug — picker chip id is `toolset:<slug>`. */
  slug: string
  /** Header text (short form). */
  label: string
  /** Long-form label for chips and references. */
  fullLabel: string
  /** One-line tooltip copy. */
  description: string
  /** Already-resolved icon (toolset's own iconId, falling back to ancestor's). */
  iconId: string
  /** Already-resolved color or empty string. */
  color: string
  /** Ordered ancestor labels, top-down. */
  path: string[]
  isDefault: boolean
  /** Curated for the Tool-Select dialog's "Popular tools" group. */
  isPopular: boolean
  tools: ToolCatalogEntry[]
}

/**
 * Flatten a catalog tree to one row per toolset, threading inherited
 * iconId/color down the recursion and recording the ancestor labels as
 * `path`. Pickers use this; the Tools tab walks the tree directly.
 */
export function flattenCatalogToToolsets(roots: CatalogNode[]): FlatToolsetCatalogEntry[] {
  const flat: FlatToolsetCatalogEntry[] = []

  function visit(
    node: CatalogNode,
    pathLabels: string[],
    inheritedIconId: string,
    inheritedColor: string
  ) {
    const iconId = node.iconId ?? inheritedIconId
    const color = node.color ?? inheritedColor

    if (node.kind === 'toolset') {
      flat.push({
        slug: node.slug,
        label: node.label,
        fullLabel: node.fullLabel,
        description: node.description,
        iconId,
        color,
        path: pathLabels,
        isDefault: node.isDefault,
        isPopular: node.isPopular,
        tools: node.tools,
      })
      return
    }
    for (const child of node.children) {
      visit(child, [...pathLabels, node.label], iconId, color)
    }
  }

  for (const root of roots) {
    visit(root, [], root.iconId ?? 'wrench', root.color ?? '')
  }
  return flat
}

export { getTriggerLabel } from './agent-trigger-label'
export type {
  KnowledgeEntry,
  KnowledgeMode,
  KnowledgeSource,
  ReconcileMentionsInput,
  ReconcileMentionsOutput,
  ToolsetEntry,
  ToolsetSource,
} from './prompt-mention-reconciler'

/**
 * Re-exports of the pure prompt → toolsets/knowledge reconciler. These run
 * client-side from the prompt-only autosave fast path so the Lock badge lights
 * up the same keystroke a `tool:<name>` chip lands, instead of waiting for the
 * server round-trip + cache invalidate. Server-side `updateAgent` runs the
 * same functions on flush, so client and server agree by construction.
 */
export {
  reconcileKnowledge,
  reconcilePromptMentions,
  reconcileToolsets,
  walkPromptDoc,
} from './prompt-mention-reconciler'
export { AGENT_SLUG_MAX, AGENT_SLUG_REGEX, agentSlugSchema } from './slug-schema'
export {
  type AgentTemplate,
  type AgentTemplateCategory,
  agentTemplates,
} from './templates'
export type { FlatToolCatalogEntry } from './toolset-catalog'
