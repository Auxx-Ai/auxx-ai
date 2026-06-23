// apps/web/src/components/data-connectors/ui/capped-node-list.tsx
'use client'

import { AnimatedCollapsibleContent, CollapsibleChevron } from '@auxx/ui/components/collapsible'
import { GridTreeRow } from '@auxx/ui/components/tree-row'
import type React from 'react'
import { useState } from 'react'
import type { SourceTreeNode } from '../hooks/use-source-paths'
import { MAPPING_COLS } from './mapping-columns'

/**
 * Max unmapped leaves rendered per container before the rest collapse behind a
 * "Show more" toggle. Branches and mapped leaves never count toward this and are
 * always shown. The single knob for every level of the mapping tree (the inert
 * skeleton AND inside promoted mappings) — change it here and it applies everywhere.
 */
export const MAX_VISIBLE_LEAVES = 7

interface CappedNodeListProps {
  /** The container's direct children, in schema order. */
  nodes: SourceTreeNode[]
  /** True for a node that counts toward the cap and may be hidden (an unmapped leaf). */
  isCappable: (node: SourceTreeNode) => boolean
  /** Render one child — must set its own `key`. */
  renderNode: (node: SourceTreeNode) => React.ReactNode
  /** Depth of the children — the "Show more" toggle aligns to it. */
  childDepth: number
}

/**
 * Renders a container's children with the unmapped-leaf cap (huge payloads like
 * GitHub return dozens of fields). Branches and mapped leaves always render in
 * schema order; unmapped leaves past {@link MAX_VISIBLE_LEAVES} are grouped into a
 * trailing {@link AnimatedCollapsibleContent} behind a "Show N more / Show less"
 * toggle. Under the cap it's a transparent pass-through (no toggle, no wrapper).
 *
 * The hidden leaves are grouped at the end (a single trailing collapse), so the
 * visible rows keep exact schema order and the reveal rides the shared spring.
 */
export function CappedNodeList({ nodes, isCappable, renderNode, childDepth }: CappedNodeListProps) {
  const [expanded, setExpanded] = useState(false)

  const cappable = nodes.filter(isCappable)
  if (cappable.length <= MAX_VISIBLE_LEAVES) {
    return <>{nodes.map(renderNode)}</>
  }

  // Hide every cappable node past the cap; everything else (branches, mapped
  // leaves, the first N unmapped leaves) stays inline in its schema position.
  const hiddenPaths = new Set(cappable.slice(MAX_VISIBLE_LEAVES).map((n) => n.path))
  const hiddenCount = hiddenPaths.size

  return (
    <>
      {nodes.filter((n) => !hiddenPaths.has(n.path)).map(renderNode)}
      <AnimatedCollapsibleContent open={expanded} className='flex flex-col'>
        {nodes.filter((n) => hiddenPaths.has(n.path)).map(renderNode)}
      </AnimatedCollapsibleContent>
      {/* Toggle sits BELOW the collapsed rows: collapsed it caps the visible list;
          expanded the revealed rows push it down so it always reads as the list's
          footer (chevron points right when collapsed, rotates down when open). */}
      <GridTreeRow
        columns={MAPPING_COLS}
        depth={childDepth}
        onToggleOpen={() => setExpanded((e) => !e)}
        icon={<CollapsibleChevron open={expanded} className='size-3.5 text-muted-foreground/50' />}
        title={
          <span className='text-xs text-muted-foreground transition-colors hover:text-foreground'>
            {expanded
              ? 'Show less'
              : `Show ${hiddenCount} more field${hiddenCount === 1 ? '' : 's'}`}
          </span>
        }
      />
    </>
  )
}
