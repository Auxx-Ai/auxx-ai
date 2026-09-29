// apps/web/src/components/data-import/plan-preview/summary-tree-row.tsx

'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { type ReactNode, useState } from 'react'

interface SummaryTreeRowProps {
  icon: ReactNode
  title: string
  description?: ReactNode
  /** Depth-1 `TreeRow`s; the row only expands when there are some. */
  children?: ReactNode
}

/** One plan-summary line: a tree row, closed by default, whose details are its children. */
export function SummaryTreeRow({ icon, title, description, children }: SummaryTreeRowProps) {
  const [open, setOpen] = useState(false)
  const expandable = !!children

  return (
    <div className='px-1 py-1'>
      <TreeRow
        icon={icon}
        expandable={expandable}
        isOpen={expandable && open}
        onToggleOpen={() => setOpen((prev) => !prev)}
        title={<span className='truncate font-medium text-sm'>{title}</span>}
        secondary={
          description ? (
            <span className='text-muted-foreground text-xs'>{description}</span>
          ) : undefined
        }>
        {expandable && children}
      </TreeRow>
    </div>
  )
}
