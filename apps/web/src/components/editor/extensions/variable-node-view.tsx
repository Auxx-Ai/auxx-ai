// apps/web/src/components/editor/extensions/variable-node-view.tsx

import { cn } from '@auxx/ui/lib/utils'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import type React from 'react'
import { useCallback } from 'react'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import {
  VariableTagContextMenu,
  VariableTagDropdown,
} from '~/components/workflow/ui/variables/variable-tag-context-menu'

/**
 * React component for rendering variable nodes in TipTap editor
 * Fetches variable data from the UnifiedVariable store using the ID
 * Supports click selection and right-click context menu for array accessor editing
 */
const VariableNodeView: React.FC<NodeViewProps> = ({ node, getPos, editor, selected }) => {
  const { variableId } = node.attrs

  // Handle click to select the variable node
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (getPos) {
        const pos = getPos()
        editor.commands.setNodeSelection(pos)
      }
    },
    [getPos, editor]
  )

  // Handle variable ID change from context menu (e.g., array accessor update)
  const handleVariableIdChange = useCallback(
    (newId: string) => {
      if (getPos && editor) {
        const pos = getPos()
        const tr = editor.state.tr
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, variableId: newId })
        editor.view.dispatch(tr)
      }
    },
    [getPos, editor, node.attrs]
  )

  return (
    <NodeViewWrapper
      as='span'
      className={cn('group/var inline-block cursor-pointer transition-all duration-200 rounded-sm')}
      data-type='variable'
      data-variable-id={variableId}
      onClick={handleClick}
      tabIndex={0}
      role='button'
      aria-selected={selected}>
      <VariableTagDropdown variableId={variableId} onVariableIdChange={handleVariableIdChange}>
        <VariableTagContextMenu variableId={variableId} onVariableIdChange={handleVariableIdChange}>
          <VariableTag
            variableId={variableId}
            nodeId={editor.storage.nodeId}
            isShort
            selected={selected}
            onVariableIdChange={handleVariableIdChange}
          />
        </VariableTagContextMenu>
      </VariableTagDropdown>
    </NodeViewWrapper>
  )
}

export default VariableNodeView
