// apps/web/src/components/workflow/ui/node-badge.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useStore as useReactFlowStore } from '@xyflow/react'
import type { VariantProps } from 'class-variance-authority'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { unifiedNodeRegistry } from '../nodes/unified-registry'

interface NodeBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** Node id, resolved against the live canvas when `title`/`nodeType` are not given. */
  nodeId?: string
  /**
   * Pre-resolved title. Skips the canvas lookup, and is the ONLY way to name a
   * node the canvas no longer has — a history entry for a deleted node, a run
   * trace for a node since removed. When both are present this wins, so a
   * historical name stays the name it had at the time.
   */
  title?: string
  /** Pre-resolved node type, for the icon. Same precedence as `title`. */
  nodeType?: string
  /** Whether to show the node-type icon (default: true). */
  showIcon?: boolean
  className?: string
}

/**
 * Inline pill for a workflow node. Nodes are not records, so this composes
 * `recordBadgeVariants` with the node-type icon, the same shape `ChannelBadge`
 * uses for integrations.
 *
 * **Must be rendered inside a `ReactFlowProvider`** whenever it has to resolve
 * anything — nodes live in React Flow's context store, not a global zustand one
 * (`store/node-store.ts` is an empty stub). Passing `title` and `nodeType`
 * avoids the *lookup* but not the subscription, so an out-of-provider caller
 * needs a presentational split rather than these props.
 *
 * @example
 * // Live node on the canvas — name and icon follow renames.
 * <NodeBadge nodeId={nodeId} />
 *
 * @example
 * // Historical reference — the name it had then, even if since renamed or deleted.
 * <NodeBadge nodeId={entry.subject.id} title={entry.subject.title} nodeType={entry.subject.nodeType} />
 */
export function NodeBadge({
  nodeId,
  title,
  nodeType,
  showIcon = true,
  className,
  variant,
  size,
}: NodeBadgeProps) {
  // Skip the subscription entirely when the caller already knows both facts.
  const liveNode = useReactFlowStore((state) =>
    nodeId && !(title && nodeType) ? state.nodes.find((node) => node.id === nodeId) : undefined
  )

  const resolvedTitle = title ?? (liveNode?.data?.title as string | undefined)
  const resolvedType = nodeType ?? (liveNode?.data?.type as string | undefined)
  const color = resolvedType ? unifiedNodeRegistry.getColor(resolvedType) : undefined

  return (
    <span data-slot='node-badge' className={cn(recordBadgeVariants({ variant, size }), className)}>
      {showIcon && resolvedType && (
        <span
          className='flex size-4 shrink-0 items-center justify-center rounded'
          style={{ backgroundColor: color ? `${color}20` : undefined, color }}>
          {unifiedNodeRegistry.getNodeIcon(resolvedType, 'size-3', liveNode?.data)}
        </span>
      )}
      <span data-slot='record-display' className='truncate max-w-[160px]'>
        {resolvedTitle || 'Unknown node'}
      </span>
    </span>
  )
}
