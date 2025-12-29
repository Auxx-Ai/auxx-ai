// apps/web/src/components/editor/extensions/variable-node-view.tsx

import React, { useCallback } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { cn } from '@auxx/ui/lib/utils'

/**
 * React component for rendering variable nodes in TipTap editor
 * Fetches variable data from the UnifiedVariable store using the ID
 * Supports click selection for the variable node
 */
const VariableNodeView: React.FC<NodeViewProps> = ({ node, getPos, editor, selected }) => {
  const { variableId } = node.attrs
  // Fetch the variable data from the store
  // let variable = useUnifiedVariable(variableId)

  // Backward compatibility: Try to find variable by path if ID lookup fails
  // const variableByPath = useUnifiedVariableStore((state) =>
  //   variableId && !variable ? state.findVariableByPath(node.attrs.path) : undefined
  // )

  // console.log('Variable lookup by path:', {
  //   path: node.attrs.path,
  //   found: !!variableByPath,
  //   variableByPath,
  //   attemptedPathLookup: variableId && !variable
  // })

  // Use the found variable or the one found by path
  // variable = variable || variableByPath

  // console.log('Final variable result:', {
  //   hasVariable: !!variable,
  //   variableId: variable?.id,
  //   variableLabel: variable?.label
  // })

  // Handle click to select the variable node
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (getPos) {
        const pos = getPos()
        // Select the entire node
        editor.commands.setNodeSelection(pos)
      }
    },
    [getPos, editor]
  )

  // Update the node with the correct variable ID if we found it by path
  // React.useEffect(() => {
  //   if (variableByPath && variableByPath.id !== variableId && editor && getPos) {
  //     // Update the node attrs with the correct variable ID
  //     const pos = getPos()
  //     editor.commands.updateAttributes(
  //       'variable-node',
  //       { variableId: variableByPath.id },
  //       { from: pos, to: pos + 1 }
  //     )
  //   }
  // }, [variableByPath, variableId, editor, getPos])

  // If variable not found in store, show placeholder
  // if (!variable) {
  //   return (
  //     <NodeViewWrapper
  //       as="span"
  //       className="inline-block px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded"
  //       onClick={handleClick}>
  //       Unknown Variable: {variableId || 'undefined'}
  //     </NodeViewWrapper>
  //   )
  // }
  // console.log('variable-node-view', variableId, editor.storage.nodeId)
  return (
    <NodeViewWrapper
      as="span"
      className={cn('group/var inline-block cursor-pointer transition-all duration-200 rounded-sm')}
      data-type="variable"
      data-variable-id={variableId}
      onClick={handleClick}
      tabIndex={0}
      role="button"
      aria-selected={selected}>
      <VariableTag
        variableId={variableId}
        nodeId={editor.storage.nodeId} // Get nodeId from editor storage
        isShort
        selected={selected}
      />
    </NodeViewWrapper>
  )
}

export default VariableNodeView
