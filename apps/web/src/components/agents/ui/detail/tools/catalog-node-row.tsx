// apps/web/src/components/agents/ui/detail/tools/catalog-node-row.tsx
'use client'

import type { CatalogNode, CatalogToolsetNode } from '@auxx/lib/agents/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils/strings'
import { Lock, Plus } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { AppIcon } from '~/components/workflow/ui/app-icon'
import { RemoveButton } from './remove-button'
import { ToolsetRow } from './toolset-row'

export type ToolsetRowState = {
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
}

interface CatalogNodeRowProps {
  node: CatalogNode
  depth: number
  /** Resolved icon — current node's `iconId` or nearest ancestor's. */
  inheritedIconId: string
  /** Resolved color — current node's `color` or nearest ancestor's. */
  inheritedColor: string | null
  stateBySlug: Map<string, ToolsetRowState>
  /** Presence = collapsed. Stable Set instance — child reads `.has()`. */
  collapsed: Set<string>
  onToggleCollapsed: (id: string) => void
  /**
   * Trash handler. For a toolset leaf, called with the leaf; for a container,
   * called with the container (the consumer is expected to bulk-remove every
   * removable descendant). Container trash auto-disables when any descendant
   * is locked.
   */
  onRemove?: (node: CatalogNode) => void
  /**
   * Optional — when supplied, app-kind container rows render an "Add" button
   * next to their tools count that invokes this with the app's node id.
   */
  onAddToApp?: (appId: string) => void
}

/**
 * One row of the installed-tools tree. Recursive — apps and sub-groups render
 * the same way and recurse into `children`; toolsets render via `ToolsetRow`.
 * Inherited icon/color cascades down the tree so a toolset without its own
 * iconId picks up the app's. See
 * `plans/kopilot/agents/tools/recursive-catalog-node.md`.
 */
export function CatalogNodeRow({
  node,
  depth,
  inheritedIconId,
  inheritedColor,
  stateBySlug,
  collapsed,
  onToggleCollapsed,
  onRemove,
  onAddToApp,
}: CatalogNodeRowProps) {
  const iconId = node.iconId ?? inheritedIconId
  const color = node.color ?? inheritedColor

  if (node.kind === 'toolset') {
    const state = stateBySlug.get(node.slug) ?? { enabled: false, source: 'manual' as const }
    return (
      <ToolsetRow
        depth={depth}
        label={node.label}
        iconId={iconId}
        color={color}
        description={node.description}
        toolCount={node.tools.length}
        source={state.source}
        onRemove={onRemove ? () => onRemove(node) : undefined}
      />
    )
  }

  const isOpen = !collapsed.has(node.id)
  const stats = summarizeContainer(node, stateBySlug)

  return (
    <TreeRow
      depth={depth}
      icon={<AppIcon iconId={iconId} color={color ?? undefined} size='sm' />}
      title={node.label}
      secondary={`${stats.enabled} ${pluralize(stats.enabled, 'tool')}`}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => onToggleCollapsed(node.id)}
      actions={
        <ContainerInstalledStats
          stats={stats}
          onAdd={node.kind === 'app' && onAddToApp ? () => onAddToApp(node.id) : undefined}
          onRemove={onRemove ? () => onRemove(node) : undefined}
        />
      }>
      {node.children.map((child) => (
        <CatalogNodeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          inheritedIconId={iconId}
          inheritedColor={color}
          stateBySlug={stateBySlug}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onRemove={onRemove}
          onAddToApp={onAddToApp}
        />
      ))}
    </TreeRow>
  )
}

interface ContainerStats {
  total: number
  enabled: number
  /** Count of `source === 'manual'` leaves — the only ones that can be removed. */
  removable: number
  /** Count of `source === 'mention'` leaves — locked by prompt @-mentions. */
  locked: number
  /**
   * Dominant lock kind to surface in the disabled-trash tooltip. `mention`
   * wins over `auto_default` so the user sees the more actionable message.
   */
  lockKind: 'mention' | 'auto_default' | null
}

function summarizeContainer(
  node: CatalogNode,
  stateBySlug: Map<string, ToolsetRowState>
): ContainerStats {
  let total = 0
  let enabled = 0
  let removable = 0
  let locked = 0
  let hasMention = false
  let hasAutoDefault = false
  for (const leaf of collectLeaves(node)) {
    total++
    const state = stateBySlug.get(leaf.slug)
    const source = state?.source ?? 'manual'
    if (state?.enabled) enabled++
    if (source === 'manual') removable++
    if (source === 'mention') {
      locked++
      hasMention = true
    }
    if (source === 'auto_default') hasAutoDefault = true
  }
  return {
    total,
    enabled,
    removable,
    locked,
    lockKind: hasMention ? 'mention' : hasAutoDefault ? 'auto_default' : null,
  }
}

export function* collectLeaves(node: CatalogNode): IterableIterator<CatalogToolsetNode> {
  if (node.kind === 'toolset') {
    yield node
    return
  }
  for (const child of node.children) yield* collectLeaves(child)
}

/**
 * Predicate: this toolset is "installed" — either explicitly enabled, or
 * mention-locked (effectively pinned by the prompt; the user should still see
 * it in the installed surface so they understand why it's active).
 */
function isInstalledLeaf(node: CatalogToolsetNode, stateBySlug: Map<string, ToolsetRowState>) {
  const state = stateBySlug.get(node.slug)
  if (!state) return false
  return state.enabled || state.source === 'mention'
}

/**
 * Walk the tree and return a copy with non-installed leaves dropped and
 * containers whose children all got dropped removed. Used by the installed
 * tools section to keep the App → SubGroup → Toolset hierarchy but only show
 * installed leaves.
 */
export function pruneToInstalled(
  nodes: CatalogNode[],
  stateBySlug: Map<string, ToolsetRowState>
): CatalogNode[] {
  const result: CatalogNode[] = []
  for (const node of nodes) {
    const pruned = pruneNode(node, stateBySlug)
    if (pruned) result.push(pruned)
  }
  return result
}

function pruneNode(
  node: CatalogNode,
  stateBySlug: Map<string, ToolsetRowState>
): CatalogNode | null {
  if (node.kind === 'toolset') {
    return isInstalledLeaf(node, stateBySlug) ? node : null
  }
  const children: CatalogNode[] = []
  for (const child of node.children) {
    const kept = pruneNode(child, stateBySlug)
    if (kept) children.push(kept)
  }
  if (children.length === 0) return null
  return { ...node, children }
}

function ContainerInstalledStats({
  stats,
  onAdd,
  onRemove,
}: {
  stats: ContainerStats
  onAdd?: () => void
  onRemove?: () => void
}) {
  const allRemovable = stats.total > 0 && stats.removable === stats.total
  const lockedTooltip =
    stats.lockKind === 'mention'
      ? "This tool is referenced in your agent's prompt. To remove it, first edit your prompt."
      : 'Required'

  return (
    <div className='flex items-center'>
      {stats.locked > 0 && (
        <Tooltip
          side='left'
          content={`${stats.locked} locked by ${pluralize(stats.locked, 'mention')} in instructions.`}>
          <span className='inline-flex items-center gap-0.5 text-[11px] text-muted-foreground me-2'>
            <Lock className='size-3' />
            {stats.locked}
          </span>
        </Tooltip>
      )}
      {onAdd && (
        <Tooltip side='left' content='Add tools to this app'>
          <button
            type='button'
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
            className='p-1 rounded-md hover:bg-primary-100 opacity-0 group-hover/tree-row:opacity-100'
            aria-label='Add tools to this app'>
            <Plus className='size-4 text-muted-foreground hover:text-foreground' />
          </button>
        </Tooltip>
      )}
      {onRemove && (
        <RemoveButton
          enabled={allRemovable}
          tooltip={allRemovable ? 'Remove all tools' : lockedTooltip}
          onClick={onRemove}
        />
      )}
    </div>
  )
}
