// apps/web/src/components/editor/inline-picker/core/inline-node-view.tsx

'use client'

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import type React from 'react'
import type { InlineNodeBadgeProps } from '../types'

/**
 * Creates a React component for rendering inline picker nodes.
 *
 * The wrapper is a minimal container with data attributes for styling:
 * - data-slot="inline-node" - for global styling hooks
 * - data-selected={boolean} - for selection state
 *
 * All visual styling is handled by the badge component.
 *
 * @param renderBadge - Function to render the badge content
 * @returns React component for NodeView
 */
export function createInlineNodeView(
  renderBadge: (props: InlineNodeBadgeProps) => React.ReactNode
) {
  return function InlineNodeView({
    node,
    selected,
    getPos,
    editor,
    updateAttributes,
    deleteNode,
  }: NodeViewProps) {
    /** Handle click to select the node */
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = getPos?.()
      if (typeof pos === 'number') {
        editor.commands.setNodeSelection(pos)
      }
    }

    const id = node.attrs.id as string

    return (
      <NodeViewWrapper
        as='div'
        data-slot='inline-node'
        data-selected={selected}
        className='inline-block cursor-pointer align-baseline'
        onClick={handleClick}>
        {renderBadge({
          id,
          selected,
          attrs: node.attrs,
          updateAttributes,
          deleteNode,
        })}
      </NodeViewWrapper>
    )
  }
}
