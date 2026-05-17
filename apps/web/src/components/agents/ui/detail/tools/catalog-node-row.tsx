// apps/web/src/components/agents/ui/detail/tools/catalog-node-row.tsx
'use client'

import type { CatalogNode, CatalogToolsetNode } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils/strings'
import { Lock, Plus } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { AppIcon } from '~/components/workflow/ui/app-icon'
import { ToolsetRow } from './toolset-row'

export type ToolsetRowState = {
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
}

/**
 * `'editor'` shows cascading Switches on containers and per-toolset Switches
 * on leaves — used by the Tool-Select dialog when we want a one-step add/remove
 * surface. `'installed'` shows a `{n} tools` chip on containers (no cascade
 * Switch) and a Trash button on leaves — used by the installed-tools section
 * where the Add-tools dialog is the source of additions.
 */
export type CatalogNodeVariant = 'editor' | 'installed'

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
  variant?: CatalogNodeVariant
  /** Required when `variant === 'editor'`. */
  onCascadeToggle?: (node: CatalogNode, nextEnabled: boolean) => void
  /** Required when `variant === 'editor'`. */
  onLeafToggle?: (slug: string, enabled: boolean) => void
  /** Required when `variant === 'installed'`. */
  onLeafRemove?: (slug: string) => void
  /**
   * Optional — when supplied + `variant === 'installed'`, app-kind rows render
   * an "Add" button next to their tools count that invokes this with the app's
   * node id.
   */
  onAddToApp?: (appId: string) => void
}

/**
 * One row of the Tools tab tree. Recursive — apps and sub-groups render the
 * same way and recurse into `children`; toolsets render via `ToolsetRow`.
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
  variant = 'editor',
  onCascadeToggle,
  onLeafToggle,
  onLeafRemove,
  onAddToApp,
}: CatalogNodeRowProps) {
  const iconId = node.iconId ?? inheritedIconId
  const color = node.color ?? inheritedColor

  if (node.kind === 'toolset') {
    const state = stateBySlug.get(node.slug) ?? { enabled: false, source: 'manual' as const }
    return (
      <ToolsetRow
        depth={depth}
        slug={node.slug}
        label={node.label}
        iconId={iconId}
        color={color}
        description={node.description}
        toolCount={node.tools.length}
        enabled={state.enabled}
        source={state.source}
        variant={variant}
        onToolsetToggle={onLeafToggle}
        onToolsetRemove={onLeafRemove}
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
      expandable
      isOpen={isOpen}
      onToggleOpen={() => onToggleCollapsed(node.id)}
      actions={
        variant === 'editor' ? (
          <ContainerEditorActions
            stats={stats}
            onToggle={(next) => onCascadeToggle?.(node, next)}
            lockedMessage={
              node.kind === 'app'
                ? 'Locked — every toolset in this app is referenced in instructions.'
                : 'Locked — every toolset in this sub-group is referenced in instructions.'
            }
          />
        ) : (
          <ContainerInstalledStats
            stats={stats}
            onAdd={node.kind === 'app' && onAddToApp ? () => onAddToApp(node.id) : undefined}
          />
        )
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
          variant={variant}
          onCascadeToggle={onCascadeToggle}
          onLeafToggle={onLeafToggle}
          onLeafRemove={onLeafRemove}
          onAddToApp={onAddToApp}
        />
      ))}
    </TreeRow>
  )
}

interface ContainerStats {
  total: number
  enabled: number
  toggleable: number
  locked: number
}

function summarizeContainer(
  node: CatalogNode,
  stateBySlug: Map<string, ToolsetRowState>
): ContainerStats {
  let total = 0
  let enabled = 0
  let toggleable = 0
  for (const leaf of collectLeaves(node)) {
    total++
    const state = stateBySlug.get(leaf.slug)
    if (state?.enabled) enabled++
    if ((state?.source ?? 'manual') !== 'mention') toggleable++
  }
  return { total, enabled, toggleable, locked: total - toggleable }
}

function* collectLeaves(node: CatalogNode): IterableIterator<CatalogToolsetNode> {
  if (node.kind === 'toolset') {
    yield node
    return
  }
  for (const child of node.children) yield* collectLeaves(child)
}

/**
 * Walk the subtree and return the toolset toggles that would change as a
 * result of cascading `nextEnabled`. Skips mention-locked rows and rows that
 * already match the desired state.
 */
export function collectToggleable(
  node: CatalogNode,
  stateBySlug: Map<string, ToolsetRowState>,
  nextEnabled: boolean
): Array<{ slug: string; enabled: boolean }> {
  const targets: Array<{ slug: string; enabled: boolean }> = []
  for (const leaf of collectLeaves(node)) {
    const state = stateBySlug.get(leaf.slug)
    if ((state?.source ?? 'manual') === 'mention') continue
    if ((state?.enabled ?? false) === nextEnabled) continue
    targets.push({ slug: leaf.slug, enabled: nextEnabled })
  }
  return targets
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

function ContainerEditorActions({
  stats,
  onToggle,
  lockedMessage,
}: {
  stats: ContainerStats
  onToggle: (next: boolean) => void
  lockedMessage: string
}) {
  const allLocked = stats.locked > 0 && stats.toggleable === 0
  const groupSwitch = (
    <Switch
      size='xs'
      checked={stats.enabled > 0}
      disabled={stats.toggleable === 0}
      onCheckedChange={(checked) => onToggle(checked)}
    />
  )
  return (
    <div className='flex items-center gap-2'>
      <span className='text-xs text-muted-foreground'>
        {stats.enabled}/{stats.total} {pluralize(stats.total, 'tool')}
      </span>
      {stats.locked > 0 && (
        <Tooltip
          side='left'
          content={`${stats.locked} locked by ${pluralize(stats.locked, 'mention')} in instructions.`}>
          <span className='inline-flex items-center gap-0.5 text-[11px] text-muted-foreground'>
            <Lock className='size-3' />
            {stats.locked}
          </span>
        </Tooltip>
      )}
      {allLocked ? (
        <Tooltip side='left' content={lockedMessage}>
          <span className='inline-flex opacity-60'>{groupSwitch}</span>
        </Tooltip>
      ) : (
        groupSwitch
      )}
    </div>
  )
}

function ContainerInstalledStats({ stats, onAdd }: { stats: ContainerStats; onAdd?: () => void }) {
  return (
    <div className='flex items-center gap-2'>
      <span className='text-xs text-muted-foreground'>
        {stats.enabled} {pluralize(stats.enabled, 'tool')}
      </span>
      {stats.locked > 0 && (
        <Tooltip
          side='left'
          content={`${stats.locked} locked by ${pluralize(stats.locked, 'mention')} in instructions.`}>
          <span className='inline-flex items-center gap-0.5 text-[11px] text-muted-foreground'>
            <Lock className='size-3' />
            {stats.locked}
          </span>
        </Tooltip>
      )}
      {onAdd && (
        <Button
          size='icon-xs'
          variant='ghost'
          aria-label='Add tools to this app'
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}>
          <Plus />
        </Button>
      )}
    </div>
  )
}
