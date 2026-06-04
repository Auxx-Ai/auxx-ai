// apps/web/src/components/agents/procedures/nodes/condition-else-node-view.tsx
'use client'

import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { CornerDownRight, X } from 'lucide-react'
import { nodePos } from './condition-helpers'

/** `conditionElse` view — the ELSE fallthrough arm (no predicate), `block+` body. */
export function ConditionElseNodeView({ node, editor, getPos }: NodeViewProps) {
  const removeArm = () => {
    const pos = nodePos(getPos)
    if (pos == null) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
  }

  return (
    <NodeViewWrapper as='div' className='my-1.5'>
      <div className='flex items-center gap-2' contentEditable={false}>
        <span className='flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700'>
          <CornerDownRight className='size-3.5' />
        </span>
        <span className='text-xs font-semibold uppercase tracking-wide text-foreground'>Else</span>
        <button
          type='button'
          onClick={removeArm}
          aria-label='Remove else branch'
          className='ml-auto rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'>
          <X className='size-3.5' />
        </button>
      </div>
      <div className='pl-8'>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  )
}
