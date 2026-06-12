// apps/web/src/components/agents/ui/detail/tools/catalog-node-row.tsx
'use client'

import type { CatalogNode, CatalogToolNode, CatalogToolsetNode } from '@auxx/lib/agents/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils/strings'
import { AlertTriangle, Lock, Plus, Settings } from 'lucide-react'
import { useBoundCredential } from '~/components/apps/hooks/use-bound-credential'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { AppWithStatusIcon } from '~/components/apps/ui/app-with-status-icon'
import { CredentialBadge } from '~/components/apps/ui/credential-badge'
import { Tooltip } from '~/components/global/tooltip'
import { RemoveButton } from './remove-button'
import { ToolsetRow } from './toolset-row'

export type ToolsetRowState = {
  enabled: boolean
  /** Pure creation provenance — lock state lives in `mentions`. */
  source: 'manual' | 'mention' | 'auto_default'
  /** Mention locks (`target: '*' | toolName`); non-empty pins the row. */
  mentions?: Array<{ target: string; source: string }>
}

/** Per-target lock for a tool row: `'*'` mentions and `auto_default` freeze every tool; a tool-name mention freezes only itself. */
function isToolTargetLocked(state: ToolsetRowState | undefined, toolName: string): boolean {
  if (!state) return false
  if (state.source === 'auto_default') return true
  return (state.mentions ?? []).some((m) => m.target === '*' || m.target === toolName)
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
   * Per-toolset allow-list (registered tool names). MCP server rows use it to
   * show an enabled-tool count (`N of M`) instead of a toolset count. A slug
   * absent from the map carries no list (legacy pass-all — all tools count
   * as enabled).
   */
  enabledToolsBySlug?: Map<string, Set<string>>
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
   * Per-tool toggle for MCP servers' inlined tool rows — removes/restores one
   * registered name in the toolset's `enabledTools` allow-list (see
   * `useToolsetMutations.toggleTool`). When omitted, MCP tool rows render
   * without remove/restore affordances.
   */
  onToggleTool?: (slug: string, toolName: string, allToolNames: string[]) => void | Promise<void>
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
  /**
   * Flag toolsets containing tools not verified safe for an untrusted visitor
   * (`externalSafe` absent). Set for chat-kind agents. See
   * plans/chat/v6/chat-tool-availability.md.
   */
  warnNotExternalSafe?: boolean
  /**
   * Toolset slugs (`mcp:<serverId>`) whose MCP connection needs reconnecting
   * (circuit open / token dead) — drives the amber status dot on the server's
   * tree icon. Other slugs render `connected`.
   */
  mcpReconnectSlugs?: Set<string>
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
  enabledToolsBySlug,
  restrictionCountBySlug,
  collapsed,
  onToggleCollapsed,
  onRemove,
  onToggleTool,
  onAddToApp,
  onOpenAccountPicker,
  boundCredIdByApp,
  warnNotExternalSafe,
  mcpReconnectSlugs,
}: CatalogNodeRowProps) {
  const iconId = node.iconId ?? inheritedIconId
  const color = node.color ?? inheritedColor

  if (node.kind === 'tool') {
    return (
      <ToolNodeRow
        depth={depth}
        tool={node}
        allToolNames={[node.name]}
        iconId={iconId}
        color={color}
        enabled={isToolNodeEnabled(node, stateBySlug, enabledToolsBySlug)}
        locked={isToolTargetLocked(stateBySlug.get(node.toolsetSlug), node.name)}
        onToggleTool={onToggleTool}
      />
    )
  }

  if (node.kind === 'toolset') {
    // Implicit toolsets never render their own row — their tools contribute
    // directly to the parent (normally inlined there; this branch covers a
    // toolset reaching the renderer directly).
    if (node.implicit) {
      const allToolNames = node.children.map((t) => t.name)
      const state = stateBySlug.get(node.slug)
      return (
        <>
          {node.children.map((tool) => (
            <ToolNodeRow
              key={tool.id}
              depth={depth}
              tool={tool}
              allToolNames={allToolNames}
              iconId={tool.iconId ?? iconId}
              color={tool.color ?? color}
              enabled={isToolNodeEnabled(tool, stateBySlug, enabledToolsBySlug)}
              locked={isToolTargetLocked(state, tool.name)}
              onToggleTool={onToggleTool}
            />
          ))}
        </>
      )
    }
    const state = stateBySlug.get(node.slug)
    return (
      <ToolsetRow
        depth={depth}
        label={node.label}
        iconId={iconId}
        color={color}
        description={node.description}
        toolCount={node.children.length}
        locked={(state?.mentions?.length ?? 0) > 0}
        restrictionCount={restrictionCountBySlug?.get(node.slug) ?? 0}
        warn={Boolean(warnNotExternalSafe) && hasUnverifiedTool(node)}
        onRemove={onRemove ? () => onRemove(node) : undefined}
      />
    )
  }

  const isOpen = !collapsed.has(node.id)
  const stats = summarizeContainer(node, stateBySlug)
  const toolCounts = containerToolStats(node, stateBySlug, enabledToolsBySlug)
  const restrictionCount = countRestrictions(node, restrictionCountBySlug)
  const containerWarn = Boolean(warnNotExternalSafe) && hasUnverifiedTool(node)
  const isApp = node.kind === 'app'
  const isMcp = node.origin === 'mcp'
  // MCP servers render as `app`-kind containers but use an org-wide connection — they get
  // none of the per-agent credential/account-picker affordances.
  const isInstalledApp = isApp && !node.isBuiltin && !isMcp
  // App container nodes carry the prefixed id `app:<appId>` so the tree can
  // disambiguate app vs. subGroup ids. Strip the prefix when handing the id
  // off to anything keyed by raw appId (bound-cred lookup, picker, etc.).
  const rawAppId = isApp ? node.id.replace(/^app:/, '') : node.id
  const boundCredId = isInstalledApp ? boundCredIdByApp?.[rawAppId] : undefined

  return (
    <TreeRow
      depth={depth}
      icon={
        isMcp ? (
          <AppWithStatusIcon
            iconId={iconId}
            color={color ?? undefined}
            size='sm'
            status={mcpReconnectSlugs?.has(node.id) ? 'expired' : 'connected'}
          />
        ) : isInstalledApp ? (
          <AppRowIcon iconId={iconId} color={color} credId={boundCredId} />
        ) : (
          <AppIcon iconId={iconId} color={color ?? undefined} size='sm' />
        )
      }
      title={node.label}
      secondary={
        isMcp ? (
          <span className='inline-flex items-center gap-2'>
            <span>
              {toolCounts.enabled} of {toolCounts.total} {pluralize(toolCounts.total, 'tool')}
            </span>
            {restrictionCount > 0 ? <RestrictionLockBadge count={restrictionCount} /> : null}
            {containerWarn ? <ChatWarnBadge /> : null}
            <McpBadge />
          </span>
        ) : isInstalledApp ? (
          <span className='inline-flex items-center gap-2'>
            <span>
              {toolCounts.enabled} {pluralize(toolCounts.enabled, 'tool')}
            </span>
            {restrictionCount > 0 ? <RestrictionLockBadge count={restrictionCount} /> : null}
            {containerWarn ? <ChatWarnBadge /> : null}
            <span className='text-muted-foreground'>·</span>
            <CredentialBadge
              credId={boundCredId}
              onPick={onOpenAccountPicker ? () => onOpenAccountPicker(rawAppId) : undefined}
            />
          </span>
        ) : (
          <span className='inline-flex items-center gap-2'>
            <span>
              {toolCounts.enabled} {pluralize(toolCounts.enabled, 'tool')}
            </span>
            {restrictionCount > 0 ? <RestrictionLockBadge count={restrictionCount} /> : null}
            {containerWarn ? <ChatWarnBadge /> : null}
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
      {inlineImplicitChildren(node.children).map((child) =>
        child.kind === 'tool' ? (
          <ToolNodeRow
            key={child.tool.id}
            depth={depth + 1}
            tool={child.tool}
            allToolNames={child.allToolNames}
            iconId={child.tool.iconId ?? iconId}
            color={child.tool.color ?? color}
            enabled={isToolNodeEnabled(child.tool, stateBySlug, enabledToolsBySlug)}
            locked={isToolTargetLocked(stateBySlug.get(child.tool.toolsetSlug), child.tool.name)}
            onToggleTool={onToggleTool}
          />
        ) : (
          <CatalogNodeRow
            key={child.node.id}
            node={child.node}
            depth={depth + 1}
            inheritedIconId={iconId}
            inheritedColor={color}
            stateBySlug={stateBySlug}
            enabledToolsBySlug={enabledToolsBySlug}
            restrictionCountBySlug={restrictionCountBySlug}
            collapsed={collapsed}
            onToggleCollapsed={onToggleCollapsed}
            onRemove={onRemove}
            onToggleTool={onToggleTool}
            onAddToApp={onAddToApp}
            onOpenAccountPicker={onOpenAccountPicker}
            boundCredIdByApp={boundCredIdByApp}
            warnNotExternalSafe={warnNotExternalSafe}
            mcpReconnectSlugs={mcpReconnectSlugs}
          />
        )
      )}
    </TreeRow>
  )
}

type InlinedChild =
  | { kind: 'node'; node: CatalogNode }
  | { kind: 'tool'; tool: CatalogToolNode; allToolNames: string[] }

/**
 * Implicit toolsets don't render their own row — their tools contribute
 * directly to the parent's child list (the doubling fix, applied generically:
 * MCP servers and ungrouped native tools alike). Explicit toolsets and
 * containers pass through as nodes.
 */
function inlineImplicitChildren(children: CatalogNode[]): InlinedChild[] {
  const out: InlinedChild[] = []
  for (const child of children) {
    if (child.kind === 'toolset' && child.implicit) {
      const allToolNames = child.children.map((t) => t.name)
      for (const tool of child.children) out.push({ kind: 'tool', tool, allToolNames })
    } else {
      out.push({ kind: 'node', node: child })
    }
  }
  return out
}

/**
 * Effective enabled state of one tool node: its toolset entry must be
 * installed and the registered name must be in the entry's `enabledTools`
 * allow-list (no list = legacy pass-all / explicit bundle).
 */
function isToolNodeEnabled(
  tool: CatalogToolNode,
  stateBySlug: Map<string, ToolsetRowState>,
  enabledToolsBySlug: Map<string, Set<string>> | undefined
): boolean {
  const state = stateBySlug.get(tool.toolsetSlug)
  if (!state || !(state.enabled || state.mentions?.length)) return false
  const allowed = enabledToolsBySlug?.get(tool.toolsetSlug)
  return allowed ? allowed.has(tool.name) : true
}

/**
 * One tool of an implicit toolset, inlined under its parent row. Enabled
 * tools render normally with a hover trash (drops the name from the
 * allow-list); disabled ones render dimmed with a hover plus (restores it).
 * Tools of a locked toolset (`source !== 'manual'`) are read-only.
 */
function ToolNodeRow({
  depth,
  tool,
  allToolNames,
  iconId,
  color,
  enabled,
  locked,
  onToggleTool,
}: {
  depth: number
  tool: CatalogToolNode
  allToolNames: string[]
  iconId: string
  color: string | null
  enabled: boolean
  locked: boolean
  onToggleTool?: (slug: string, toolName: string, allToolNames: string[]) => void | Promise<void>
}) {
  const canToggle = Boolean(onToggleTool) && !locked
  return (
    <TreeRow
      depth={depth}
      icon={<AppIcon iconId={iconId} color={color ?? undefined} size='sm' />}
      title={tool.label}
      description={tool.description || undefined}
      rowClassName={enabled ? undefined : 'opacity-60'}
      actions={
        canToggle ? (
          enabled ? (
            <RemoveButton
              enabled
              tooltip='Remove tool'
              onClick={() => void onToggleTool?.(tool.toolsetSlug, tool.name, allToolNames)}
            />
          ) : (
            <Tooltip side='left' content='Enable tool' allowInteraction>
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  void onToggleTool?.(tool.toolsetSlug, tool.name, allToolNames)
                }}
                className='p-1 rounded-md hover:bg-primary-100 opacity-0 group-hover/tree-row:opacity-100'
                aria-label='Enable tool'>
                <Plus className='size-4 text-muted-foreground hover:text-foreground' />
              </button>
            </Tooltip>
          )
        ) : locked ? (
          <Tooltip
            side='left'
            content="This tool is referenced in your agent's prompt. To change it, first edit your prompt.">
            <span className='inline-flex p-1 opacity-0 group-hover/tree-row:opacity-100'>
              <Lock className='size-3 text-muted-foreground' />
            </span>
          </Tooltip>
        ) : undefined
      }
    />
  )
}

/** Small "MCP" provenance tag shown in an MCP server container row's secondary slot. */
function McpBadge() {
  return (
    <span className='inline-flex items-center rounded border border-border px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
      MCP
    </span>
  )
}

/** True when any toolset leaf under `node` has a tool that isn't `externalSafe`. */
function hasUnverifiedTool(node: CatalogNode): boolean {
  for (const leaf of collectLeaves(node)) {
    if (leaf.children.some((t) => t.externalSafe !== true)) return true
  }
  return false
}

/** Amber warning badge for toolsets not verified safe for visitor chat. */
function ChatWarnBadge() {
  return (
    <Tooltip content='Not verified safe for visitor chat — scope its arguments under Restrictions.'>
      <span className='inline-flex'>
        <AlertTriangle className='size-3 text-amber-500' />
      </span>
    </Tooltip>
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
  /** Count of leaves not pinned by a prompt/procedure mention — these can be removed. */
  removable: number
  /** Count of mention-locked leaves (`mentions` non-empty). */
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
    if (state?.enabled) enabled++
    if (state?.mentions?.length) locked++
    else removable++
  }
  return { total, enabled, removable, locked }
}

/**
 * Enabled-vs-total **tool** count for a container — everything counts tools,
 * toolset counts were always a proxy. An installed explicit bundle counts all
 * of its members; an installed implicit toolset counts its `enabledTools`
 * allow-list (no list = legacy pass-all); uninstalled leaves count zero.
 */
function containerToolStats(
  node: CatalogNode,
  stateBySlug: Map<string, ToolsetRowState>,
  enabledToolsBySlug: Map<string, Set<string>> | undefined
): { enabled: number; total: number } {
  let total = 0
  let enabled = 0
  for (const leaf of collectLeaves(node)) {
    total += leaf.children.length
    const state = stateBySlug.get(leaf.slug)
    if (!state || !(state.enabled || state.mentions?.length)) continue
    const allowed = leaf.implicit ? enabledToolsBySlug?.get(leaf.slug) : undefined
    if (allowed) {
      for (const tool of leaf.children) if (allowed.has(tool.name)) enabled++
    } else {
      enabled += leaf.children.length
    }
  }
  return { enabled, total }
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
  if (node.kind === 'tool') return
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
  return state.enabled || (state.mentions?.length ?? 0) > 0
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
  if (node.kind === 'tool') return node
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
