// apps/web/src/lib/extensions/components/workflow/fields/field-row.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import React from 'react'

/**
 * WorkflowFieldRow — horizontal layout container for use inside WorkflowVarFieldGroup.
 *
 * Renders a flex-row div with the same bottom-border as VarEditorFieldRow so it blends
 * seamlessly when mixed with VarField rows inside a VarFieldGroup.
 * Children with expand={true} get flex-1 min-w-0; others get shrink-0.
 * If no child has expand, the last child expands by default.
 */
export const WorkflowFieldRow = ({ children }: { children: React.ReactNode }) => {
  const childArray = React.Children.toArray(children)
  const hasAnyExpand = childArray.some(
    (c) => React.isValidElement(c) && (c.props as any).expand === true
  )
  const lastIndex = childArray.length - 1

  return (
    <div className='flex flex-row items-stretch border-b dark:border-b-[#404754]/20'>
      {childArray.map((child, i) => {
        const childExpand = React.isValidElement(child) && (child.props as any).expand === true
        const shouldExpand = hasAnyExpand ? childExpand : i === lastIndex
        return (
          <div
            key={i}
            className={cn('flex items-stretch', shouldExpand ? 'min-w-0 flex-1' : 'shrink-0')}>
            {child}
          </div>
        )
      })}
    </div>
  )
}
