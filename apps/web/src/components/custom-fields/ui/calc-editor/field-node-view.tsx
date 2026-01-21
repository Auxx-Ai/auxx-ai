// apps/web/src/components/custom-fields/ui/calc-editor/field-node-view.tsx
'use client'

import React, { useCallback } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { cn } from '@auxx/ui/lib/utils'
import { Badge } from '@auxx/ui/components/badge'

/** Field metadata stored in editor storage */
interface AvailableField {
  key: string
  label: string
  type: string
}

/**
 * React component for rendering field nodes in formula TipTap editor.
 * Displays field references as styled badges.
 */
const FieldNodeView: React.FC<NodeViewProps> = ({ node, getPos, editor, selected }) => {
  const { fieldKey } = node.attrs

  // Get field metadata from editor storage (set by parent component)
  const availableFields = editor.storage.availableFields as AvailableField[] | undefined

  const field = availableFields?.find((f) => f.key === fieldKey)
  const isUnknown = !field

  /** Handle click to select the field node */
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

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        'inline-block cursor-pointer transition-all duration-200 rounded-sm mx-0.5',
        selected && 'ring-2 ring-primary ring-offset-1'
      )}
      data-type="field"
      data-field-key={fieldKey}
      onClick={handleClick}
      tabIndex={0}
      role="button"
      aria-selected={selected}
    >
      <Badge
        variant={isUnknown ? 'destructive' : 'secondary'}
        className={cn('font-mono text-xs px-1.5 py-0', selected && 'bg-primary text-primary-foreground')}
      >
        {field?.label ?? fieldKey}
        {isUnknown && ' ⚠'}
      </Badge>
    </NodeViewWrapper>
  )
}

export default FieldNodeView
