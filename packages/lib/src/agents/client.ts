// packages/lib/src/agents/client.ts

/**
 * Client-safe exports from `@auxx/lib/agents`. The barrel `index.ts` pulls
 * in server-only deps (DB, capabilities); this subpath is what client
 * components should import from.
 */

export type AgentScopeMode = 'include_descendants' | 'include_one' | 'exclude'

/**
 * Where a tool may run — mirrors `AgentKind` (`internal | chat`) plus the
 * agent-builder Kopilot and the future email agent. A tool's `surfaces` is an
 * allow-list; absent ⇒ {@link ALL_SURFACES} (offered everywhere). NOT a
 * security boundary — adding a toolset to an agent (admin act) + the
 * restriction engine are. See plans/chat/v6/chat-tool-availability.md.
 */
export type AgentSurface = 'internal' | 'chat' | 'email' | 'builder'

/** Default `surfaces` when a tool declares none — offered on every surface. */
export const ALL_SURFACES: readonly AgentSurface[] = ['internal', 'chat', 'email', 'builder']

export interface ToolCatalogEntry {
  name: string
  /** Short, human-friendly label for chips, pickers, and audit UI. */
  displayName: string
  description: string
  /**
   * Surfaces this tool is offered on. Absent ⇒ {@link ALL_SURFACES}. Mirrors
   * `AgentToolDefinition.surfaces`; drives `filterCatalogToSurface`. Not a gate.
   */
  surfaces?: AgentSurface[]
  /**
   * Advisory: verified safe for an untrusted, externally-identified caller
   * (anonymous/just-verified chat visitor, email sender). Absent ⇒ the
   * chat/email Tools UI flags the tool with a warning. Replaces `chatSafe`.
   * Not a gate. See plans/chat/v6/chat-tool-availability.md.
   */
  externalSafe?: boolean
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
  /**
   * True only for the synthetic `Auxx.ai` app at the catalog root. Lets the
   * Tools tab suppress credential / account-picker affordances that don't
   * apply to built-in toolsets.
   */
  isBuiltin?: boolean
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

/**
 * Shared search predicate over a flat toolset entry — the union of fields the
 * Tools tab and the toolset picker were each filtering on independently: slug,
 * both labels, description, ancestor path, and member tool names. An empty query
 * matches everything.
 */
export function matchesToolsetSearch(entry: FlatToolsetCatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    entry.slug.toLowerCase().includes(q) ||
    entry.label.toLowerCase().includes(q) ||
    entry.fullLabel.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q) ||
    entry.path.join(' ').toLowerCase().includes(q) ||
    entry.tools.some(
      (t) => t.name.toLowerCase().includes(q) || t.displayName.toLowerCase().includes(q)
    )
  )
}

/**
 * Prune a catalog tree to the tools offered on `surface`, dropping any toolset
 * left with zero tools and any container left with no children. A tool with no
 * `surfaces` defaults to {@link ALL_SURFACES} (offered everywhere), so with
 * today's tools this only drops builder-only tools from non-builder surfaces.
 * Pure — returns fresh nodes, never mutates the input. See
 * plans/chat/v6/chat-tool-availability.md.
 */
export function filterCatalogToSurface(roots: CatalogNode[], surface: AgentSurface): CatalogNode[] {
  const pruneNode = (node: CatalogNode): CatalogNode | null => {
    if (node.kind === 'toolset') {
      const tools = node.tools.filter((t) => (t.surfaces ?? ALL_SURFACES).includes(surface))
      return tools.length > 0 ? { ...node, tools } : null
    }
    const children = node.children.map(pruneNode).filter((n): n is CatalogNode => n !== null)
    return children.length > 0 ? { ...node, children } : null
  }
  return roots.map(pruneNode).filter((n): n is CatalogNode => n !== null)
}

/**
 * Structural subtype of `CachedInstalledApp` covering exactly what
 * `buildCatalogTreeFromInstallations` needs to read. Defining it here in the
 * client subpath avoids dragging the full `CachedInstalledApp` type (which
 * pulls in cache-internal deps) into client bundles. Server-side callers can
 * still pass the full `CachedInstalledApp[]` — TypeScript structural typing
 * makes it assignment-compatible.
 */
export interface CachedInstalledAppLike {
  app: {
    id: string
    title: string
    avatarUrl: string | null
  }
  agentToolsets?: ReadonlyArray<{
    slug: string
    name: string
    description: string
    iconKey: string | null
    subGroup: string | null
    shortLabel?: string
    color?: string
    isDefault?: boolean
    isPopular?: boolean
    subGroupIconId?: string
    subGroupColor?: string
  }>
  agentTools?: ReadonlyArray<{
    id: string
    name: string
    description: string
    toolsetSlug: string
    /** Mirrors `AgentToolDefinition.surfaces` — where the tool is offered. Absent ⇒ all. */
    surfaces?: AgentSurface[]
    /** Mirrors `AgentToolDefinition.externalSafe` — drives the chat/email warning. */
    externalSafe?: boolean
  }>
}

const BUILTIN_APP_ID = 'auxx'

/**
 * Tool descriptions in the registry are LLM-facing and can run several
 * paragraphs. The Tools tab tooltip only needs a one-liner — take the first
 * sentence (up to 200 chars).
 */
function shortDescription(description: string): string {
  const trimmed = description.trim()
  const sentenceEnd = trimmed.search(/[.!?]\s/)
  const candidate = sentenceEnd > 0 ? trimmed.slice(0, sentenceEnd + 1) : trimmed
  return candidate.length > 200 ? `${candidate.slice(0, 197)}…` : candidate
}

interface ToolsetInput {
  slug: string
  fullLabel: string
  shortLabel: string
  iconId: string | null
  color: string | null
  isDefault: boolean
  isPopular: boolean
  description: string
  subGroup: string | null
  subGroupIconId: string | null
  subGroupColor: string | null
  tools: ToolCatalogEntry[]
}

function toToolsetNode(ts: ToolsetInput): CatalogToolsetNode {
  return {
    kind: 'toolset',
    id: ts.slug,
    slug: ts.slug,
    label: ts.shortLabel,
    fullLabel: ts.fullLabel,
    iconId: ts.iconId,
    color: ts.color,
    description: ts.description,
    isDefault: ts.isDefault,
    isPopular: ts.isPopular,
    tools: [...ts.tools].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function compareLeaves(a: CatalogToolsetNode, b: CatalogToolsetNode): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  return a.label.localeCompare(b.label)
}

function buildAppNode(args: {
  id: string
  title: string
  iconId: string
  color: string | null
  isBuiltin?: boolean
  toolsets: ToolsetInput[]
}): CatalogContainerNode {
  const bySubGroup = new Map<string | null, ToolsetInput[]>()
  // First non-null per (icon, color) wins. Walk the toolset list once;
  // siblings update the meta as they're seen.
  const subGroupMeta = new Map<string, { iconId: string | null; color: string | null }>()
  for (const ts of args.toolsets) {
    const key = ts.subGroup
    const list = bySubGroup.get(key) ?? []
    list.push(ts)
    bySubGroup.set(key, list)

    if (ts.subGroup) {
      const prev = subGroupMeta.get(ts.subGroup)
      if (!prev) {
        subGroupMeta.set(ts.subGroup, {
          iconId: ts.subGroupIconId,
          color: ts.subGroupColor,
        })
      } else {
        if (!prev.iconId && ts.subGroupIconId) prev.iconId = ts.subGroupIconId
        if (!prev.color && ts.subGroupColor) prev.color = ts.subGroupColor
      }
    }
  }

  const subGroupChildren: CatalogContainerNode[] = []
  const flatChildren: CatalogToolsetNode[] = []
  for (const [subGroup, list] of bySubGroup.entries()) {
    if (subGroup === null) {
      for (const ts of list) flatChildren.push(toToolsetNode(ts))
    } else {
      const meta = subGroupMeta.get(subGroup)
      subGroupChildren.push({
        kind: 'subGroup',
        id: `sub:${args.id}:${subGroup}`,
        label: subGroup,
        iconId: meta?.iconId ?? null,
        color: meta?.color ?? null,
        children: list.map(toToolsetNode).sort(compareLeaves),
      })
    }
  }

  subGroupChildren.sort((a, b) => a.label.localeCompare(b.label))
  flatChildren.sort(compareLeaves)

  return {
    kind: 'app',
    id: `app:${args.id}`,
    label: args.title,
    iconId: args.iconId,
    color: args.color,
    isBuiltin: args.isBuiltin,
    children: [...subGroupChildren, ...flatChildren],
  }
}

function compareAppNodes(a: CatalogContainerNode, b: CatalogContainerNode): number {
  if (a.isBuiltin) return -1
  if (b.isBuiltin) return 1
  return a.label.localeCompare(b.label)
}

/**
 * Pure function — produces the `CatalogNode[]` shape every renderer
 * already consumes. Walks `appInstallations` (including the synthetic
 * auxx row prepended by `installedAppsProvider`), groups leaves by
 * sub-group, sorts containers, returns the tree. Client-safe; the server
 * delegates to this from `getOrgCatalogTree`.
 */
export function buildCatalogTreeFromInstallations(
  installations: ReadonlyArray<CachedInstalledAppLike>
): CatalogNode[] {
  const apps: CatalogContainerNode[] = []

  for (const inst of installations) {
    const agentToolsets = inst.agentToolsets ?? []
    if (agentToolsets.length === 0) continue

    const agentTools = inst.agentTools ?? []
    const toolsBySlug = new Map<string, ToolCatalogEntry[]>()
    for (const tool of agentTools) {
      const arr = toolsBySlug.get(tool.toolsetSlug) ?? []
      arr.push({
        name: tool.id,
        displayName: tool.name,
        description: shortDescription(tool.description),
        surfaces: tool.surfaces,
        externalSafe: tool.externalSafe,
      })
      toolsBySlug.set(tool.toolsetSlug, arr)
    }

    const isBuiltin = inst.app.id === BUILTIN_APP_ID
    // Apps store an avatar URL on the App row. Pass it through verbatim to
    // <AppIcon> — parseIconString routes `https://...` and `url:/...`
    // through the <img> branch. Lucide fallback when no avatarUrl.
    const appIconId = inst.app.avatarUrl ?? 'package'

    apps.push(
      buildAppNode({
        id: inst.app.id,
        title: inst.app.title,
        iconId: appIconId,
        color: null,
        isBuiltin: isBuiltin || undefined,
        toolsets: agentToolsets.map((ts) => ({
          slug: ts.slug,
          fullLabel: ts.name,
          shortLabel: ts.shortLabel ?? ts.name,
          iconId: ts.iconKey,
          color: ts.color ?? null,
          isDefault: ts.isDefault ?? false,
          isPopular: ts.isPopular ?? false,
          description: ts.description ?? '',
          subGroup: ts.subGroup ?? null,
          subGroupIconId: ts.subGroupIconId ?? null,
          subGroupColor: ts.subGroupColor ?? null,
          tools: toolsBySlug.get(ts.slug) ?? [],
        })),
      })
    )
  }

  apps.sort(compareAppNodes)
  return apps
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
