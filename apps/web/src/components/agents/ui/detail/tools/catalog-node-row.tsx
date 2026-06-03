// apps/web/src/components/agents/ui/detail/tools/catalog-node-row.tsx
'use client'

import type { CatalogNode, CatalogToolsetNode } from '@auxx/lib/agents/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils/strings'
import { Lock, Plus, Settings } from 'lucide-react'
import { useBoundCredential } from '~/components/apps/hooks/use-bound-credential'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { AppWithStatusIcon } from '~/components/apps/ui/app-with-status-icon'
import { CredentialBadge } from '~/components/apps/ui/credential-badge'
import { Tooltip } from '~/components/global/tooltip'
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
  /**
   * Read-only restriction count per toolset slug. When a leaf has ≥1, a lock
   * badge renders; container rows roll up descendant counts into `secondary`.
   * Managing restrictions happens in the Restrictions section. See
   * plans/chat/v6 phase-4.
   */
  restrictionCountBySlug?: Map<string, number>
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
  /**
   * Optional — when supplied, app-kind container rows render a cog button
   * that opens the credential picker dialog for that app.
   */
  onOpenAccountPicker?: (appId: string) => void
  /**
   * Per-app credId bindings from the agent. Used to render the credential
   * badge in the row's `secondary` slot and to color the status dot on
   * `AppWithStatusIcon`. See plans/kopilot/apps/agent-credentials.md §5.6.
   */
  boundCredIdByApp?: Record<string, string | undefined>
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
  restrictionCountBySlug,
  collapsed,
  onToggleCollapsed,
  onRemove,
  onAddToApp,
  onOpenAccountPicker,
  boundCredIdByApp,
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
        restrictionCount={restrictionCountBySlug?.get(node.slug) ?? 0}
        onRemove={onRemove ? () => onRemove(node) : undefined}
      />
    )
  }

  const isOpen = !collapsed.has(node.id)
  const stats = summarizeContainer(node, stateBySlug)
  const restrictionCount = countRestrictions(node, restrictionCountBySlug)
  const isApp = node.kind === 'app'
  const isInstalledApp = isApp && !node.isBuiltin
  // App container nodes carry the prefixed id `app:<appId>` so the tree can
  // disambiguate app vs. subGroup ids. Strip the prefix when handing the id
  // off to anything keyed by raw appId (bound-cred lookup, picker, etc.).
  const rawAppId = isApp ? node.id.replace(/^app:/, '') : node.id
  const boundCredId = isInstalledApp ? boundCredIdByApp?.[rawAppId] : undefined

  return (
    <TreeRow
      depth={depth}
      icon={
        isInstalledApp ? (
          <AppRowIcon iconId={iconId} color={color} credId={boundCredId} />
        ) : (
          <AppIcon iconId={iconId} color={color ?? undefined} size='sm' />
        )
      }
      title={node.label}
      secondary={
        isInstalledApp ? (
          <span className='inline-flex items-center gap-2'>
            <span>
              {stats.enabled} {pluralize(stats.enabled, 'tool')}
            </span>
            {restrictionCount > 0 ? <RestrictionLockBadge count={restrictionCount} /> : null}
            <span className='text-muted-foreground'>·</span>
            <CredentialBadge
              credId={boundCredId}
              onPick={onOpenAccountPicker ? () => onOpenAccountPicker(rawAppId) : undefined}
            />
          </span>
        ) : (
          <span className='inline-flex items-center gap-2'>
            <span>
              {stats.enabled} {pluralize(stats.enabled, 'tool')}
            </span>
            {restrictionCount > 0 ? <RestrictionLockBadge count={restrictionCount} /> : null}
          </span>
        )
      }
      expandable
      isOpen={isOpen}
      onToggleOpen={() => onToggleCollapsed(node.id)}
      actions={
        <ContainerInstalledStats
          stats={stats}
          onAdd={isApp && onAddToApp ? () => onAddToApp(node.id) : undefined}
          onOpenAccountPicker={
            isInstalledApp && onOpenAccountPicker ? () => onOpenAccountPicker(rawAppId) : undefined
          }
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
          restrictionCountBySlug={restrictionCountBySlug}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onRemove={onRemove}
          onAddToApp={onAddToApp}
          onOpenAccountPicker={onOpenAccountPicker}
          boundCredIdByApp={boundCredIdByApp}
        />
      ))}
    </TreeRow>
  )
}

/**
 * App-row icon variant with a status dot overlay. Looks up the credential
 * state via the same hook the badge uses so the dot and the inline label
 * never disagree.
 */
function AppRowIcon({
  iconId,
  color,
  credId,
}: {
  iconId: string
  color: string | null
  credId: string | undefined
}) {
  const bound = useBoundCredential(credId)
  return (
    <AppWithStatusIcon iconId={iconId} color={color ?? undefined} size='sm' status={bound.status} />
  )
}

interface ContainerStats {
  total: number
  enabled: number
  /** Count of leaves not pinned by a prompt @-mention — these can be removed. */
  removable: number
  /** Count of `source === 'mention'` leaves — locked by prompt @-mentions. */
  locked: number
}

function summarizeContainer(
  node: CatalogNode,
  stateBySlug: Map<string, ToolsetRowState>
): ContainerStats {
  let total = 0
  let enabled = 0
  let removable = 0
  let locked = 0
  for (const leaf of collectLeaves(node)) {
    total++
    const state = stateBySlug.get(leaf.slug)
    const source = state?.source ?? 'manual'
    if (state?.enabled) enabled++
    if (source === 'mention') locked++
    else removable++
  }
  return { total, enabled, removable, locked }
}

/** Sum the restriction counts of every toolset leaf under a node. */
function countRestrictions(
  node: CatalogNode,
  restrictionCountBySlug: Map<string, number> | undefined
): number {
  if (!restrictionCountBySlug) return 0
  let total = 0
  for (const leaf of collectLeaves(node)) total += restrictionCountBySlug.get(leaf.slug) ?? 0
  return total
}

/** Small read-only lock badge + count, reusing the mention-lock `Lock` glyph. */
function RestrictionLockBadge({ count }: { count: number }) {
  return (
    <Tooltip content={`${count} ${pluralize(count, 'restricted argument')}`}>
      <span className='inline-flex items-center gap-0.5 text-[11px] text-muted-foreground'>
        <Lock className='size-3' />
        {count}
      </span>
    </Tooltip>
  )
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
  onOpenAccountPicker,
  onRemove,
}: {
  stats: ContainerStats
  onAdd?: () => void
  onOpenAccountPicker?: () => void
  onRemove?: () => void
}) {
  const allRemovable = stats.total > 0 && stats.removable === stats.total
  const lockedTooltip =
    "This tool is referenced in your agent's prompt. To remove it, first edit your prompt."

  return (
    <div className='flex items-center'>
      {stats.locked > 0 && (
        <Tooltip
          side='left'
          content={`${stats.locked} locked by ${pluralize(stats.locked, 'mention')} in instructions.`}>
          <span className='inline-flex items-center gap-0.5 text-[11px] text-muted-foreground me-2 opacity-0 group-hover/tree-row:opacity-100'>
            <Lock className='size-3' />
            {stats.locked}
          </span>
        </Tooltip>
      )}
      {onOpenAccountPicker && (
        <Tooltip side='left' content='Choose account for this app' allowInteraction>
          <button
            type='button'
            onClick={(e) => {
              e.stopPropagation()
              onOpenAccountPicker()
            }}
            className='p-1 rounded-md hover:bg-primary-100 opacity-0 group-hover/tree-row:opacity-100'
            aria-label='Choose account for this app'>
            <Settings className='size-4 text-muted-foreground hover:text-foreground' />
          </button>
        </Tooltip>
      )}
      {onAdd && (
        <Tooltip side='left' content='Add tools to this app' allowInteraction>
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
