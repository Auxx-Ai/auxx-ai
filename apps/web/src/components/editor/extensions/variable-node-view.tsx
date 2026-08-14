// apps/web/src/components/editor/extensions/variable-node-view.tsx

import { cn } from '@auxx/ui/lib/utils'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import type React from 'react'
import { useCallback } from 'react'
import type { AllowedVarType } from '~/components/workflow/types'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { VariableTagContextMenu } from '~/components/workflow/ui/variables/variable-tag-context-menu'

/**
 * React component for rendering variable nodes in TipTap editor.
 *
 * Gesture split, matching the picker-mode chip in `var-editor.tsx`:
 * - **left-click** → the variable explorer, pre-navigated to this variable's own
 *   path, so a chip can be re-pointed without deleting and retyping `{`
 * - **right-click** → array access for every array in the path
 *
 * The node's field type contract arrives through `editor.storage.expectedTypes`
 * — a NodeView only receives `node`/`getPos`/`editor`/`selected`, so editor
 * storage is the only channel (same one `nodeId` already uses).
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

  // Handle variable ID change from the context menu (array accessor) or the
  // explorer (a different variable entirely).
  //
  // `setNodeMarkup` keeps the node type, so ProseMirror reuses the node view and
  // React re-renders this component in place rather than remounting it — which
  // is what lets the context menu stay open across several accessor edits.
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

  const allowedTypes = (editor.storage.expectedTypes ?? []) as AllowedVarType[]

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
      <VariablePicker
        nodeId={editor.storage.nodeId}
        value={variableId}
        allowedTypes={allowedTypes}
        onVariableSelect={(variable) => handleVariableIdChange(variable.id)}>
        {/* A stable element for `PopoverTrigger asChild` — the context menu
            renders a bare fragment when the path holds no arrays, and cloning
            props onto a fragment would drop the trigger's handlers. */}
        <span className='inline-flex'>
          <VariableTagContextMenu
            variableId={variableId}
            onVariableIdChange={handleVariableIdChange}>
            <VariableTag
              variableId={variableId}
              nodeId={editor.storage.nodeId}
              isShort
              selected={selected}
              onVariableIdChange={handleVariableIdChange}
            />
          </VariableTagContextMenu>
        </span>
      </VariablePicker>
    </NodeViewWrapper>
  )
}

export default VariableNodeView
