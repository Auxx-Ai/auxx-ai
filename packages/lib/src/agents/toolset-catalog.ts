// packages/lib/src/agents/toolset-catalog.ts

import { getOrgCache } from '../cache'
import {
  type AgentSurface,
  buildCatalogTreeFromInstallations,
  type CatalogContainerNode,
  type CatalogNode,
  type CatalogToolsetNode,
  filterCatalogToSurface,
  type ToolCatalogEntry,
} from './client'

export type {
  CatalogContainerNode,
  CatalogNode,
  CatalogToolsetNode,
  ToolCatalogEntry,
} from './client'

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
 * client renderers use `CatalogNode` instead.
 */
export interface ToolsetCatalogEntry {
  slug: string
  label: string
  appId: string
  isDefault: boolean
  tools: ToolCatalogEntry[]
}

/**
 * Recursive catalog tree — one `CatalogNode` per app at the root. Built
 * client-side from `appInstallations` (the synthetic built-in `auxx` row is
 * prepended by `installedAppsProvider`); this server-side variant delegates
 * to the same builder over the cached `installedApps` envelope. The Tools
 * tab and the toolset/tool pickers all consume this shape; backend callers
 * use `getOrgToolsetCatalog` / `getOrgToolCatalog` for flat projections.
 */
export async function getOrgCatalogTree(organizationId: string): Promise<CatalogNode[]> {
  const installedApps = await getOrgCache().get(organizationId, 'installedApps')
  return buildCatalogTreeFromInstallations(installedApps)
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

/**
 * Flat toolset catalog clamped to one surface — the same projection as
 * `getOrgToolsetCatalog`, dropping tools not offered on `surface` (and toolsets
 * left empty). Used by the agent builder so a chat agent's persona advertises —
 * and `set_agent_toolsets` validates against — exactly the toolsets that survive
 * `buildChatEngineConfig`'s runtime surface filter. With default-all `surfaces`,
 * this only drops surface-narrowed tools (e.g. builder meta-tools). See
 * plans/chat/v6/chat-tool-availability.md.
 */
export async function getOrgToolsetCatalogForSurface(
  organizationId: string,
  surface: AgentSurface
): Promise<ToolsetCatalogEntry[]> {
  const tree = filterCatalogToSurface(await getOrgCatalogTree(organizationId), surface)
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
    for (const child of (root as CatalogContainerNode).children) visit(child, appId)
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
