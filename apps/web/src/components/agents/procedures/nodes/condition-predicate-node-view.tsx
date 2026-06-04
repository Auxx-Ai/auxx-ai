// apps/web/src/components/agents/procedures/nodes/condition-predicate-node-view.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { useMemo } from 'react'
import { nodePos } from './condition-helpers'

/**
 * `conditionPredicate` view — the natural-language predicate writer. Renders as a
 * bordered box with a placeholder hint; its `inline*` content holds the prose +
 * attribute badges (`@`). Hidden when the parent {@link ConditionCase} is in
 * `structured` mode (the builder takes over there) — detected by walking the PM
 * parent for its `mode` attr (same technique as panel-node-view.tsx).
 */
export function ConditionPredicateNodeView({ node, editor, getPos }: NodeViewProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `node` re-resolves parent mode on each doc change
  const parentMode = useMemo(() => {
    const pos = nodePos(getPos)
    if (pos == null) return 'text'
    try {
      return (editor.state.doc.resolve(pos).parent.attrs.mode as string) ?? 'text'
    } catch {
      return 'text'
    }
  }, [editor, getPos, node])

  const isEmpty = node.content.size === 0
  const hidden = parentMode === 'structured'

  return (
    <NodeViewWrapper
      as='div'
      className={cn(
        'relative my-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm',
        hidden && 'hidden'
      )}>
      <NodeViewContent className='min-h-5 outline-none' />
      {isEmpty && (
        <span
          className='pointer-events-none absolute left-3 top-2 select-none text-muted-foreground/60'
          contentEditable={false}
          aria-hidden='true'>
          Write a condition in natural language, type “@” to insert attribute.
        </span>
      )}
    </NodeViewWrapper>
  )
}
