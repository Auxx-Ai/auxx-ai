// apps/web/src/components/agents/procedures/nodes/condition-block-node-view.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Plus } from 'lucide-react'
import { appendChild, newConditionCase, newConditionElse, nodePos } from './condition-helpers'

/**
 * `conditionBlock` view — an IF / ELSE-IF / ELSE construct rendered inline-expanded
 * (plan §4, the screenshot). Renders its arm children via {@link NodeViewContent}
 * and a footer to append another ELSE-IF arm or (once) the ELSE arm. Arm order is
 * the IF/ELSE-IF precedence the compiler reads.
 */
export function ConditionBlockNodeView({ node, editor, getPos }: NodeViewProps) {
  const hasElse = node.lastChild?.type.name === 'conditionElse'

  const addCase = () => {
    const pos = nodePos(getPos)
    if (pos != null) appendChild(editor, pos, newConditionCase())
  }
  const addElse = () => {
    const pos = nodePos(getPos)
    if (pos != null) appendChild(editor, pos, newConditionElse())
  }

  return (
    <NodeViewWrapper as='div' className='my-2' data-condition-block=''>
      <NodeViewContent />
      <div className='mt-1 flex items-center gap-2 pl-8' contentEditable={false}>
        <Button variant='ghost' size='xs' onClick={addCase}>
          <Plus />
          Else if
        </Button>
        {!hasElse && (
          <Button variant='ghost' size='xs' onClick={addElse}>
            <Plus />
            Else
          </Button>
        )}
      </div>
    </NodeViewWrapper>
  )
}
