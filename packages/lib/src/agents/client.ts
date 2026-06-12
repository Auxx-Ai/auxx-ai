// packages/lib/src/agents/client.ts

/**
 * Client-safe exports from `@auxx/lib/agents`. The barrel `index.ts` pulls
 * in server-only deps (DB, capabilities); this subpath is what client
 * components should import from.
 */

import type { ToolCategory } from '../ai/agent-framework/types'

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
  /** MCP-only: tool's `readOnlyHint`. Drives the per-tool lock/check icon. */
  readOnly?: boolean
  /** MCP-only: admin-trusted (runs without approval). Drives the per-tool icon. */
  trusted?: boolean
  /**
   * Platform visibility class. Absent ⇒ `'capability'`. Drives the eval mock
   * editor's system-group collapse (control tools never reach the catalog).
   */
  category?: ToolCategory
  /** Read-only — may run live under `passthrough_readonly`; drives the read-only badge. */
  idempotent?: boolean
  /**
   * JSON Schema of the tool's success output. Absent/empty ⇒ no declared
   * schema (free-form mock). The eval editor derives its scaffold seed from
   * this via {@link scaffoldFromJsonSchema} — never persisted.
   */
  outputsJsonSchema?: Record<string, unknown>
  /** One realistic sample output — the preferred mock seed AND the runtime live-default. */
  exampleOutput?: unknown
}

/**
 * Recursive catalog node mirrored from the server. App, sub-group, toolset,
 * and tool all share this shape; `kind` discriminates visual treatment. See
 * `toolset-catalog.ts` for the canonical shape and
 * `plans/mcp/v4/tool-first-catalog.md` for the model (tools as first-class
 * nodes; toolsets as optional groupings).
 */
export type CatalogNode = CatalogContainerNode | CatalogToolsetNode | CatalogToolNode

interface CatalogNodeBase {
  id: string
  label: string
  iconId: string | null
  color: string | null
  /**
   * Provenance of this node — `'app'` (default) or `'mcp'`. Render code
   * discriminates on this, never on slug prefixes. Set by `buildMcpCatalogNodes`.
   */
  origin?: 'app' | 'mcp'
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
  /**
   * `true` when this toolset was **synthesized** rather than author-declared:
   * MCP servers (`mcp:<serverId>`) and the per-app group holding ungrouped
   * native tools (`app:<appId>`). Implicit toolsets are per-tool selectable
   * (`config.enabledTools`) and never render their own row — their children
   * contribute directly to the parent's row list. Explicit (`false`) toolsets
   * are atomic authored bundles: one row, no per-tool UI.
   */
  implicit: boolean
  children: CatalogToolNode[]
}

/** A tool as a first-class catalog node — the unit users see and select. */
export interface CatalogToolNode extends CatalogNodeBase {
  kind: 'tool'
  /**
   * Registered name (`mcp__<slug>__<tool>` for MCP, `getRegisteredToolName`
   * for app tools) — what `enabledTools` and restrictions key on. `label`
   * carries the human-friendly `displayName`.
   */
  name: string
  /** Slug of the owning toolset — the persistence join key. */
  toolsetSlug: string
  description: string
  /** Mirrors {@link ToolCatalogEntry.surfaces}. */
  surfaces?: AgentSurface[]
  /** Mirrors {@link ToolCatalogEntry.externalSafe}. */
  externalSafe?: boolean
  /** MCP-only: tool's `readOnlyHint`. */
  readOnly?: boolean
  /** MCP-only: admin-trusted (runs without approval). */
  trusted?: boolean
  /** Mirrors {@link ToolCatalogEntry.category}. */
  category?: ToolCategory
  /** Mirrors {@link ToolCatalogEntry.idempotent}. */
  idempotent?: boolean
  /** Mirrors {@link ToolCatalogEntry.outputsJsonSchema}. */
  outputsJsonSchema?: Record<string, unknown>
  /** Mirrors {@link ToolCatalogEntry.exampleOutput}. */
  exampleOutput?: unknown
}

/** Implicit-toolset slug for an app's ungrouped native tools. Stable across builds (derived from the app id); MCP keeps `mcp:<serverId>`. */
export function implicitAppToolsetSlug(appId: string): string {
  return `app:${appId}`
}

/** Project a {@link CatalogToolNode} back to the flat {@link ToolCatalogEntry} data shape. */
export function toolNodeToEntry(node: CatalogToolNode): ToolCatalogEntry {
  return {
    name: node.name,
    displayName: node.label,
    description: node.description,
    surfaces: node.surfaces,
    externalSafe: node.externalSafe,
    readOnly: node.readOnly,
    trusted: node.trusted,
    category: node.category,
    idempotent: node.idempotent,
    outputsJsonSchema: node.outputsJsonSchema,
    exampleOutput: node.exampleOutput,
  }
}

/** Lift a flat {@link ToolCatalogEntry} into a {@link CatalogToolNode} under `toolsetSlug`. */
export function toolEntryToNode(
  entry: ToolCatalogEntry,
  toolsetSlug: string,
  origin?: 'app' | 'mcp'
): CatalogToolNode {
  return {
    kind: 'tool',
    id: entry.name,
    name: entry.name,
    label: entry.displayName,
    toolsetSlug,
    description: entry.description,
    iconId: null,
    color: null,
    origin,
    surfaces: entry.surfaces,
    externalSafe: entry.externalSafe,
    readOnly: entry.readOnly,
    trusted: entry.trusted,
    category: entry.category,
    idempotent: entry.idempotent,
    outputsJsonSchema: entry.outputsJsonSchema,
    exampleOutput: entry.exampleOutput,
  }
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
  /** Provenance — `'app'` (absent ⇒ app) or `'mcp'`. Pickers group/badge on this. */
  origin?: 'app' | 'mcp'
  /** Mirrors {@link CatalogToolsetNode.implicit} — implicit sets get per-tool selection. */
  implicit: boolean
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
    inheritedColor: string,
    inheritedOrigin: 'app' | 'mcp'
  ) {
    const iconId = node.iconId ?? inheritedIconId
    const color = node.color ?? inheritedColor
    const origin = node.origin ?? inheritedOrigin

    if (node.kind === 'tool') return
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
        origin,
        implicit: node.implicit,
        tools: node.children.map(toolNodeToEntry),
      })
      return
    }
    for (const child of node.children) {
      visit(child, [...pathLabels, node.label], iconId, color, origin)
    }
  }

  for (const root of roots) {
    visit(root, [], root.iconId ?? 'wrench', root.color ?? '', root.origin ?? 'app')
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

/** One enabled toolset on an agent — the client mirror of `ResolvedAgentConfig.toolsets[*]`. */
export interface AgentToolsetSelection {
  slug: string
  /**
   * Per-tool allow-list of registered names (implicit toolsets only).
   * `null`/absent ⇒ no per-tool config — every member tool passes.
   */
  enabledTools?: readonly string[] | null
}

/**
 * Client mirror of the runtime `filterToolsByToolsets` (`agents/filter-tools.ts`):
 * keep a toolset iff its slug is enabled for the agent; within it keep a tool iff
 * the entry has no allow-list (`null`) or the list includes the tool's registered
 * name (fail-closed otherwise). Toolsets left with zero tools are dropped. Used
 * by the eval case editor to derive the agent's baseline tool set from the full
 * catalog without a server round trip. Pure.
 */
export function filterCatalogToAgentToolsets(
  entries: FlatToolsetCatalogEntry[],
  toolsets: AgentToolsetSelection[]
): FlatToolsetCatalogEntry[] {
  const bySlug = new Map(toolsets.map((t) => [t.slug, t.enabledTools ?? null]))
  return entries
    .filter((entry) => bySlug.has(entry.slug))
    .map((entry) => {
      const enabled = bySlug.get(entry.slug) ?? null
      return enabled === null
        ? entry
        : { ...entry, tools: entry.tools.filter((t) => enabled.includes(t.name)) }
    })
    .filter((entry) => entry.tools.length > 0)
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
    if (node.kind === 'tool') {
      return (node.surfaces ?? ALL_SURFACES).includes(surface) ? node : null
    }
    if (node.kind === 'toolset') {
      const children = node.children.filter((t) => (t.surfaces ?? ALL_SURFACES).includes(surface))
      return children.length > 0 ? { ...node, children } : null
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
    /**
     * LLM-facing name the bridge registers this tool under
     * (`getRegisteredToolName(appSlug, id)` for app tools, the bare name for
     * built-ins). This — not the raw manifest `id` — is the catalog entry's
     * `name`, so `tool:<name>` chips, system-prompt references, eval mocks, and
     * the runtime toolset all speak one name. See
     * plans/kopilot/agents/tool-chip-registered-name.md.
     */
    registeredName: string
    description: string
    /**
     * Optional — grouping is an authoring choice. Tools without a slug land
     * in the app's synthesized implicit toolset ({@link implicitAppToolsetSlug})
     * and get per-tool selection. See plans/mcp/v4/tool-first-catalog.md.
     */
    toolsetSlug?: string
    /** Mirrors `AgentToolDefinition.surfaces` — where the tool is offered. Absent ⇒ all. */
    surfaces?: AgentSurface[]
    /** Mirrors `AgentToolDefinition.externalSafe` — drives the chat/email warning. */
    externalSafe?: boolean
    /** Mirrors {@link ToolCatalogEntry.category}. Absent ⇒ `'capability'`. */
    category?: ToolCategory
    /** Mirrors {@link ToolCatalogEntry.idempotent}. */
    idempotent?: boolean
    /** Mirrors {@link ToolCatalogEntry.outputsJsonSchema}. Empty `{}` ⇒ no schema. */
    outputsJsonSchema?: Record<string, unknown>
    /** Mirrors {@link ToolCatalogEntry.exampleOutput}. */
    exampleOutput?: unknown
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
  /** Synthesized (ungrouped tools) rather than author-declared. */
  implicit?: boolean
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
    implicit: ts.implicit ?? false,
    children: [...ts.tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => toolEntryToNode(tool, ts.slug)),
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
    const agentTools = inst.agentTools ?? []

    // Grouping is optional: tools whose `toolsetSlug` names a declared toolset
    // join it; the rest (no slug, or a slug no toolset declares) land in the
    // app's synthesized implicit toolset and get per-tool selection. An app
    // may mix grouped and bare tools.
    const declaredSlugs = new Set(agentToolsets.map((ts) => ts.slug))
    const implicitSlug = implicitAppToolsetSlug(inst.app.id)
    const toolsBySlug = new Map<string, ToolCatalogEntry[]>()
    for (const tool of agentTools) {
      const slug =
        tool.toolsetSlug && declaredSlugs.has(tool.toolsetSlug) ? tool.toolsetSlug : implicitSlug
      const arr = toolsBySlug.get(slug) ?? []
      arr.push({
        name: tool.registeredName,
        displayName: tool.name,
        description: shortDescription(tool.description),
        surfaces: tool.surfaces,
        externalSafe: tool.externalSafe,
        category: tool.category,
        idempotent: tool.idempotent,
        outputsJsonSchema: tool.outputsJsonSchema,
        exampleOutput: tool.exampleOutput,
      })
      toolsBySlug.set(slug, arr)
    }

    const ungrouped = toolsBySlug.get(implicitSlug) ?? []
    if (agentToolsets.length === 0 && ungrouped.length === 0) continue

    const isBuiltin = inst.app.id === BUILTIN_APP_ID
    // Apps store an avatar URL on the App row. Pass it through verbatim to
    // <AppIcon> — parseVisualRef routes `https://...` and `url:/...`
    // through the <img> branch. Lucide fallback when no avatarUrl.
    const appIconId = inst.app.avatarUrl ?? 'package'

    const toolsets: ToolsetInput[] = agentToolsets.map((ts) => ({
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
    }))
    if (ungrouped.length > 0) {
      toolsets.push({
        slug: implicitSlug,
        fullLabel: inst.app.title,
        shortLabel: inst.app.title,
        iconId: null,
        color: null,
        isDefault: false,
        isPopular: false,
        description: '',
        subGroup: null,
        subGroupIconId: null,
        subGroupColor: null,
        implicit: true,
        tools: ungrouped,
      })
    }

    apps.push(
      buildAppNode({
        id: inst.app.id,
        title: inst.app.title,
        iconId: appIconId,
        color: null,
        isBuiltin: isBuiltin || undefined,
        toolsets,
      })
    )
  }

  apps.sort(compareAppNodes)
  return apps
}

// ===== MCP catalog (client-safe) =====

const MCP_MAX_TOOL_NAME_LENGTH = 60
const MCP_HASH_SUFFIX_LENGTH = 6

/**
 * Deterministic FNV-1a 32-bit hash → hex. Portable (no node:crypto) so the SAME
 * `mcpToolName` runs in the browser catalog and the server runtime — registered
 * names must match exactly or an agent's disable-list stops matching the tool.
 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Registered tool name: `mcp__<serverSlug>__<toolName>`. If it would exceed 60 chars, truncate
 * the tool part and append a deterministic 6-char suffix (collision-safe, stable across syncs).
 * Defined here (client-safe) and re-exported from `@auxx/lib/ai/mcp` so runtime + catalog agree.
 */
export function mcpToolName(serverSlug: string, toolName: string): string {
  const full = `mcp__${serverSlug}__${toolName}`
  if (full.length <= MCP_MAX_TOOL_NAME_LENGTH) return full
  const prefix = `mcp__${serverSlug}__`
  const hash = fnv1aHex(full).slice(0, MCP_HASH_SUFFIX_LENGTH)
  const room = Math.max(1, MCP_MAX_TOOL_NAME_LENGTH - prefix.length - 1 - MCP_HASH_SUFFIX_LENGTH)
  return `${prefix}${toolName.slice(0, room)}_${hash}`
}

/**
 * Client-safe projection of a connected MCP server, mirrored from `CachedMcpServer`. Carries the
 * fields the builder catalog + tool-meta resolvers need; excludes server-only data (input schemas,
 * sync errors used only by settings). Built in the extensions provider (phase 5) from `mcp.list`.
 */
export interface ClientMcpServer {
  serverId: string
  slug: string
  name: string
  description: string | null
  iconUrl: string | null
  toolsetSlug: string
  connectionPresent: boolean
  /** Circuit-open / token dead — drives the tree status icon. */
  needsReconnect?: boolean
  lastSyncError: string | null
  tools: Array<{
    name: string
    description: string | null
    readOnlyHint: boolean
    trusted: boolean
    /** Result JSON Schema (server/inferred/manual) — feeds the catalog entry's outputsJsonSchema. */
    outputsJsonSchema?: Record<string, unknown>
  }>
}

/**
 * Build catalog nodes for connected MCP servers — one `CatalogContainerNode` (kind `'app'`,
 * `origin: 'mcp'`) per server with ≥1 tool, holding one `CatalogToolsetNode` (`mcp:<serverId>`).
 * Tool entries use the **registered** name via `mcpToolName` so disable-lists match runtime names.
 * The same builder runs server-side (catalog merge) and client-side (builder tree).
 */
export function buildMcpCatalogNodes(servers: ClientMcpServer[]): CatalogNode[] {
  const nodes: CatalogContainerNode[] = []
  for (const server of servers) {
    if (!server.connectionPresent || server.tools.length === 0) continue
    const tools: ToolCatalogEntry[] = server.tools.map((t) => ({
      name: mcpToolName(server.slug, t.name),
      displayName: t.name,
      description: t.description ?? '',
      readOnly: t.readOnlyHint,
      trusted: t.trusted,
      // MCP tools are ordinary capabilities; readOnlyHint is the idempotence signal.
      idempotent: t.readOnlyHint,
      // Output schema (server-declared/inferred/manual) flows into the eval editor's mock
      // scaffolding; absent ⇒ the editor renders "no schema — author freely".
      outputsJsonSchema: t.outputsJsonSchema,
    }))
    const toolsetNode: CatalogToolsetNode = {
      kind: 'toolset',
      origin: 'mcp',
      id: server.toolsetSlug,
      slug: server.toolsetSlug,
      label: server.name,
      fullLabel: `${server.name} — MCP`,
      description: server.description ?? '',
      isDefault: false,
      isPopular: false,
      iconId: server.iconUrl ?? null,
      color: null,
      implicit: true,
      children: [...tools]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((tool) => toolEntryToNode(tool, server.toolsetSlug, 'mcp')),
    }
    nodes.push({
      kind: 'app',
      origin: 'mcp',
      id: server.toolsetSlug, // `mcp:<serverId>` — NOT `app:`-prefixed
      label: server.name,
      iconId: server.iconUrl ?? 'plug',
      color: null,
      children: [toolsetNode],
    })
  }
  nodes.sort((a, b) => a.label.localeCompare(b.label))
  return nodes
}

/** One resolver entry per MCP tool — `registeredName → display metadata`. */
export interface McpToolMetaEntry {
  /** Registered tool name (`mcp__<slug>__<tool>`) — the join key in chat/eval/bindings maps. */
  name: string
  displayName: string
  description: string
  /** Server icon (URL) or the `plug` fallback id. */
  iconId: string
  serverName: string
  toolsetSlug: string
}

/**
 * Flatten connected MCP servers to one display-meta entry per tool, keyed by the **registered**
 * name (`mcpToolName`), so the kopilot tool pill, bindings rows, and eval transcripts can resolve
 * MCP tool calls the same way they resolve app tools. Mirrors `buildMcpCatalogNodes`' naming.
 */
export function buildMcpToolMetaEntries(servers: ClientMcpServer[]): McpToolMetaEntry[] {
  const entries: McpToolMetaEntry[] = []
  for (const server of servers) {
    if (!server.connectionPresent) continue
    for (const tool of server.tools) {
      entries.push({
        name: mcpToolName(server.slug, tool.name),
        displayName: tool.name,
        description: tool.description ?? '',
        iconId: server.iconUrl ?? 'plug',
        serverName: server.name,
        toolsetSlug: server.toolsetSlug,
      })
    }
  }
  return entries
}

export { getTriggerLabel } from './agent-trigger-label'
export type {
  KnowledgeEntry,
  KnowledgeMode,
  KnowledgeSource,
  MentionOverrides,
  ReconcileMentionsInput,
  ReconcileMentionsOutput,
  ToolsetEntry,
  ToolsetMention,
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
  type MentionSource,
  reconcileKnowledgeMentions,
  reconcilePromptMentions,
  reconcileToolsetMentions,
  walkPromptDoc,
  walkPromptDocs,
} from './prompt-mention-reconciler'
/**
 * Derive the eval mock editor's empty-but-correctly-shaped seed from a tool's
 * `outputsJsonSchema`. Computed at render time client-side — never stored.
 */
export { scaffoldFromJsonSchema } from './scaffold-from-json-schema'
export { AGENT_SLUG_MAX, AGENT_SLUG_REGEX, agentSlugSchema } from './slug-schema'
export {
  type AgentTemplate,
  type AgentTemplateCategory,
  agentTemplates,
} from './templates'
/**
 * Visibility-policy helpers — pure (they only read `category`), re-exported
 * here so client code (eval editor grouping) shares the one policy table with
 * the server barrel.
 */
export { isToolVisibleOn, type ToolVisibilitySurface, toolCategory } from './tool-visibility'
export type { FlatToolCatalogEntry } from './toolset-catalog'
export type { ToolCategory }
