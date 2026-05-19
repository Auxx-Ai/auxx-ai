// packages/lib/src/agents/toolset-catalog.ts

import type { AgentToolDefinition } from '../ai/agent-framework/types'
import type { GetToolDeps, PageCapability } from '../ai/kopilot/capabilities'
import {
  createActorCapabilities,
  createEntityCapabilities,
  createKbCapabilities,
  createKbReadCapabilities,
  createKnowledgeCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
} from '../ai/kopilot/capabilities'
import { getOrgCache } from '../cache'
import { BUILTIN_APP, BUILTIN_TOOLSETS } from './builtin-app'

/**
 * Catalog entry describing a toolset and the tools it exposes. Read by the
 * admin Tools tab to render the per-agent toolset selector. Catalog-only —
 * per-agent enabled state lives on `agent.getById.toolsets`.
 */
export interface ToolCatalogEntry {
  name: string
  /** Short, human-friendly label for chips, pickers, and audit UI. */
  displayName: string
  description: string
}

/**
 * Flat per-tool catalog entry — every tool exposed by the org, paired with the
 * parent toolset's resolved display metadata and the path of container labels
 * (`['Auxx.ai', 'Mail']`) so a picker can render a one-line item without
 * walking the tree.
 */
export interface FlatToolCatalogEntry {
  name: string
  displayName: string
  description: string
  toolsetSlug: string
  toolsetLabel: string
  /** Already-resolved icon (toolset's own iconId, falling back to ancestor's). */
  toolsetIconId: string
  /** Already-resolved color (toolset's own color, falling back to ancestor's). */
  toolsetColor: string
  /**
   * Ordered labels of the toolset's ancestor containers, top-down. For a
   * built-in nested under a sub-group this is `['Auxx.ai', 'Mail']`; for a
   * flat third-party toolset it's `['Google Calendar']`.
   */
  path: string[]
}

/**
 * Flat per-toolset projection of the catalog tree. Backend callers
 * (persona-prompt rendering, set-agent-toolsets validation, default-toolsets
 * resolution, prompt-mention reconciler) consume this slug-keyed shape;
 * client renderers use `CatalogNode` instead. See
 * `plans/kopilot/agents/tools/recursive-catalog-node.md`.
 */
export interface ToolsetCatalogEntry {
  slug: string
  label: string
  appId: string
  isDefault: boolean
  tools: ToolCatalogEntry[]
}

/**
 * Recursive catalog node. App, sub-group, and toolset all share this shape —
 * `kind` discriminates visual treatment; `children` vs `tools` discriminates
 * container vs leaf. See `plans/kopilot/agents/tools/recursive-catalog-node.md`.
 */
export type CatalogNode = CatalogContainerNode | CatalogToolsetNode

interface CatalogNodeBase {
  /**
   * Stable id for React keys and cascade walks. App = `'app:<appId>'`,
   * sub-group = `'sub:<appId>:<subGroupName>'`, toolset = the runtime
   * `slug` (`'auxx:mail:threads'` | `'app:gog-calendar:availability'`).
   */
  id: string
  /** Header text. App.title | sub-group name | toolset shortLabel. */
  label: string
  /** Same shape as `<AppIcon>` iconId (Lucide id / URL / base64 / emoji). */
  iconId: string | null
  /** Tailwind-ish color key consumed by `<AppIcon color>` and badges. */
  color: string | null
}

export interface CatalogContainerNode extends CatalogNodeBase {
  kind: 'app' | 'subGroup'
  children: CatalogNode[]
  /**
   * True only for the synthetic `Auxx.ai` app at the catalog root. Lets the
   * Tools tab suppress credential / account-picker affordances that don't
   * apply to built-in toolsets. See `builtin-app.ts`.
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
 * Stub `getDeps` for catalog enumeration. Tool factories capture `getDeps` in
 * a closure for `execute`-time use only — constructing the tool definition
 * (name, description, toolsetSlug) never invokes the factory.
 */
const catalogGetDeps: GetToolDeps = () => {
  throw new Error('toolset-catalog: getDeps is for metadata enumeration only')
}

function collectNativeCapabilities(): PageCapability[] {
  return [
    createMailCapabilities(catalogGetDeps),
    createEntityCapabilities(catalogGetDeps),
    createKnowledgeCapabilities(catalogGetDeps),
    createActorCapabilities(catalogGetDeps),
    createTaskCapabilities(catalogGetDeps),
    createKbCapabilities(catalogGetDeps),
    createKbReadCapabilities(catalogGetDeps),
  ]
}

/**
 * In-process catalog cache. The built-in portion is invariant per process; the
 * app portion is rebuilt from the already-cached `installedApps` row in
 * <5 ms, so this TTL only debounces repeat `agentToolset.list` queries within
 * a single turn. App install/uninstall/deploy events bust `installedApps`
 * which is the upstream source — admins can also call
 * `invalidateToolsetCatalog` for an immediate bust.
 */
const CATALOG_CACHE_TTL_MS = 1_000
const catalogTreeCache = new Map<string, { value: CatalogNode[]; expiresAt: number }>()

function readCache<T>(cache: Map<string, { value: T; expiresAt: number }>, key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function writeCache<T>(
  cache: Map<string, { value: T; expiresAt: number }>,
  key: string,
  value: T
): void {
  cache.set(key, { value, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS })
}

/**
 * Bust this org's cached catalog tree. Call after admin actions that change
 * the installed-apps catalog (app install / uninstall / deploy).
 */
export function invalidateToolsetCatalog(orgId: string): void {
  catalogTreeCache.delete(orgId)
}

/**
 * Recursive catalog tree — one `CatalogNode` per app at the root. The Tools
 * tab and the toolset/tool pickers all consume this shape; backend callers
 * use `getOrgToolsetCatalog` / `getOrgToolCatalog` which derive flat
 * projections from this tree.
 */
export async function getOrgCatalogTree(organizationId: string): Promise<CatalogNode[]> {
  const cached = readCache(catalogTreeCache, organizationId)
  if (cached) return cached
  const value = await buildOrgCatalogTree(organizationId)
  writeCache(catalogTreeCache, organizationId, value)
  return value
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
  /** Sub-group header icon; first non-null across same-subGroup rows wins. */
  subGroupIconId: string | null
  /** Sub-group header color; first non-null across same-subGroup rows wins. */
  subGroupColor: string | null
  tools: ToolCatalogEntry[]
}

async function buildOrgCatalogTree(organizationId: string): Promise<CatalogNode[]> {
  // 1. Group native tools by their `toolsetSlug` tag.
  const nativeToolsBySlug = new Map<string, Map<string, ToolCatalogEntry>>()
  for (const capability of collectNativeCapabilities()) {
    for (const tool of capability.tools as AgentToolDefinition[]) {
      const slug = tool.toolsetSlug
      if (!slug) continue
      let bucket = nativeToolsBySlug.get(slug)
      if (!bucket) {
        bucket = new Map()
        nativeToolsBySlug.set(slug, bucket)
      }
      if (!bucket.has(tool.name)) {
        bucket.set(tool.name, {
          name: tool.name,
          displayName: tool.displayName,
          description: shortDescription(tool.description),
        })
      }
    }
  }

  const apps: CatalogContainerNode[] = []

  // 2. Built-in `auxx` app.
  apps.push(
    buildAppNode({
      id: BUILTIN_APP.id,
      title: BUILTIN_APP.title,
      iconId: BUILTIN_APP.iconId,
      color: null,
      isBuiltin: true,
      toolsets: BUILTIN_TOOLSETS.map((meta) => ({
        slug: meta.slug,
        fullLabel: meta.label,
        shortLabel: meta.shortLabel,
        iconId: meta.iconId,
        color: meta.color,
        isDefault: meta.isDefault,
        isPopular: meta.isPopular,
        description: meta.description,
        subGroup: meta.subGroup,
        subGroupIconId: meta.subGroupIconId,
        subGroupColor: meta.subGroupColor,
        tools: nativeToolsBySlug.get(meta.slug)
          ? [...nativeToolsBySlug.get(meta.slug)!.values()]
          : [],
      })),
    })
  )

  // 3. Installed apps — same producer fn, different source.
  const installedApps = await getOrgCache().get(organizationId, 'installedApps')
  for (const inst of installedApps) {
    const aiTools = inst.aiTools ?? []
    const aiToolsets = inst.aiToolsets ?? []
    if (aiToolsets.length === 0) continue

    const appToolsBySlug = new Map<string, ToolCatalogEntry[]>()
    for (const tool of aiTools) {
      const arr = appToolsBySlug.get(tool.toolsetSlug) ?? []
      arr.push({
        name: tool.id,
        displayName: tool.name,
        description: shortDescription(tool.description),
      })
      appToolsBySlug.set(tool.toolsetSlug, arr)
    }

    // Apps store an avatar URL on the App row. Pass it through verbatim to
    // <AppIcon> — parseIconString routes `https://...` through the <img> branch.
    // Lucide fallback when an app row has no avatarUrl.
    const appIconId = inst.app.avatarUrl ?? 'package'

    apps.push(
      buildAppNode({
        id: inst.app.id,
        title: inst.app.title,
        iconId: appIconId,
        color: null,
        toolsets: aiToolsets.map((ts) => ({
          slug: ts.slug,
          fullLabel: ts.name,
          shortLabel: ts.name,
          iconId: ts.iconKey ?? null,
          color: null,
          // App toolsets are never defaulted (per plans/kopilot/apps/gog-calendar-overhaul.md §0);
          // admins pick each one deliberately, which doubles as the write-approval gate.
          isDefault: false,
          // SDK doesn't expose `isPopular` yet — third-party toolsets default
          // to false. Deferred to a future SDK-side iteration.
          isPopular: false,
          description: ts.description ?? '',
          subGroup: ts.subGroup ?? null,
          // App-side sub-group icon/color stays inherited from the app row.
          // SDK exposure of these fields is deferred to a future iteration
          // (see plans/kopilot/agents/tools/recursive-catalog-node.md PR 3).
          subGroupIconId: null,
          subGroupColor: null,
          tools: appToolsBySlug.get(ts.slug) ?? [],
        })),
      })
    )
  }

  apps.sort(compareAppNodes)
  return apps
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

function compareAppNodes(a: CatalogContainerNode, b: CatalogContainerNode): number {
  if (a.id === `app:${BUILTIN_APP.id}`) return -1
  if (b.id === `app:${BUILTIN_APP.id}`) return 1
  return a.label.localeCompare(b.label)
}

/**
 * Flat per-toolset projection of the catalog tree. Backend consumers
 * (persona-prompt rendering, set-agent-toolsets validation, default-toolsets
 * resolution) use this slug-keyed shape; renderers use `getOrgCatalogTree`.
 */
export async function getOrgToolsetCatalog(organizationId: string): Promise<ToolsetCatalogEntry[]> {
  const tree = await getOrgCatalogTree(organizationId)
  return flattenToolsets(tree)
}

function flattenToolsets(roots: CatalogNode[]): ToolsetCatalogEntry[] {
  const flat: ToolsetCatalogEntry[] = []
  function visit(node: CatalogNode, appId: string) {
    if (node.kind === 'toolset') {
      flat.push({
        slug: node.slug,
        label: node.fullLabel,
        appId,
        isDefault: node.isDefault,
        tools: node.tools,
      })
      return
    }
    for (const child of node.children) visit(child, appId)
  }
  for (const root of roots) {
    if (root.kind === 'toolset') continue
    // Strip the `app:` prefix so callers get the raw app id they expect.
    const appId = root.id.startsWith('app:') ? root.id.slice('app:'.length) : root.id
    for (const child of root.children) visit(child, appId)
  }
  return flat
}

/**
 * Flat per-tool catalog — one row per tool exposed by the org, with the
 * parent toolset's resolved icon/color and ancestor labels.
 */
export async function getOrgToolCatalog(organizationId: string): Promise<FlatToolCatalogEntry[]> {
  const roots = await getOrgCatalogTree(organizationId)
  const flat: FlatToolCatalogEntry[] = []

  // Thread inherited icon/color down the recursion — mirrors the render-side
  // fallback so flat consumers (pickers, badges) get a resolved iconId
  // instead of a bare `null`.
  function visit(
    node: CatalogNode,
    pathLabels: string[],
    inheritedIconId: string,
    inheritedColor: string
  ) {
    const iconId = node.iconId ?? inheritedIconId
    const color = node.color ?? inheritedColor

    if (node.kind === 'toolset') {
      for (const tool of node.tools) {
        flat.push({
          name: tool.name,
          displayName: tool.displayName,
          description: tool.description,
          toolsetSlug: node.slug,
          toolsetLabel: node.fullLabel,
          toolsetIconId: iconId,
          toolsetColor: color,
          path: pathLabels,
        })
      }
      return
    }
    for (const child of node.children) {
      visit(child, [...pathLabels, node.label], iconId, color)
    }
  }

  for (const root of roots) {
    visit(root, [], root.iconId ?? 'package', root.color ?? '')
  }
  flat.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return flat
}

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
