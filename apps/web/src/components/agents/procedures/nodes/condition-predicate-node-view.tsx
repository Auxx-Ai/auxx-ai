// apps/web/src/components/agents/procedures/nodes/condition-predicate-node-view.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'

/**
 * `conditionPredicate` view — the natural-language predicate writer. Renders as a
 * bordered box with a placeholder hint; its `inline*` content holds the prose +
 * attribute badges (`@`). Hidden when the arm is in `structured` mode (the builder
 * takes over there). Reads its own `mode` attr, kept in lockstep with the parent
 * arm by `applyBlockMode` so the toggle re-renders (and hides) this node.
 */
export function ConditionPredicateNodeView({ node }: NodeViewProps) {
  const isEmpty = node.content.size === 0
  const hidden = node.attrs.mode === 'structured'

  return (
    <NodeViewWrapper
      as='div'
      className={cn(
        'relative rounded-lg border border-border border-dashed bg-background/40 px-3 py-1 text-sm',
        hidden && 'hidden'
      )}>
      <NodeViewContent className='min-h-5 outline-none' />
      {isEmpty && (
        <span
          className='pointer-events-none absolute left-3 top-1 select-none text-muted-foreground/60'
          contentEditable={false}
          aria-hidden='true'>
          Write a condition in natural language, type “@” to insert attribute.
        </span>
      )}
    </NodeViewWrapper>
  )
}
