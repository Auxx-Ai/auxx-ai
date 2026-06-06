// apps/web/src/components/agents/procedures/nodes/condition-else-node-view.tsx
'use client'

import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, useEditorState } from '@tiptap/react'
import { CornerDownRight, X } from 'lucide-react'
import {
  computeOutlinePath,
  procedureLineNumberFormatter,
  procedureNumberPolicy,
} from '~/components/editor/rich-text/outline-numbering'
import { nodePos } from './condition-helpers'

/** `conditionElse` view — the ELSE fallthrough arm (no predicate), `block+` body. */
export function ConditionElseNodeView({ node, editor, getPos }: NodeViewProps) {
  // `{blockNum}.{armNum}` (e.g. "6.3"). Display-only. Read via `useEditorState`
  // so it re-renders on position-only doc shifts (the node view isn't otherwise
  // re-rendered for those, which would leave the number stale).
  const armLabel = useEditorState({
    editor,
    selector: ({ editor }) => {
      const pos = nodePos(getPos)
      if (pos == null) return null
      const path = computeOutlinePath(editor.state.doc, pos, procedureNumberPolicy)
      return procedureLineNumberFormatter({
        path,
        nodeName: node.type.name,
        depth: path.length - 1,
      })
    },
  })

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
        <span className='min-w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
          {armLabel}
        </span>
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
