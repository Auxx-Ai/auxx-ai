// packages/ui/src/components/view-mode-toggle.tsx
'use client'

import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { LayoutGrid, List } from 'lucide-react'

/** Grid vs table list rendering. */
export type ListViewMode = 'grid' | 'table'

interface ViewModeToggleProps {
  value: ListViewMode
  onValueChange: (value: ListViewMode) => void
  className?: string
}

/**
 * Grid/table view switch shared by list pages (Workflows, Datasets). Drop it into
 * a `ListToolbarGroup align='end'`.
 */
export function ViewModeToggle({ value, onValueChange, className }: ViewModeToggleProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as ListViewMode)}
      className={className}>
      <TabsList className='h-7'>
        <TabsTrigger value='grid' className='h-5 px-1.5'>
          <LayoutGrid className='size-4' />
        </TabsTrigger>
        <TabsTrigger value='table' className='h-5 px-1.5'>
          <List className='size-4' />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
