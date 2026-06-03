// apps/web/src/components/kb/ui/sources/sources-filter-bar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { type SourceStatusFilter, useSources } from './sources-provider'

/** Search + status filter for the Sources tab. */
export function SourcesFilterBar() {
  const { searchQuery, setSearchQuery, selectedStatus, setSelectedStatus } = useSources()

  return (
    <div className='flex items-center border-b gap-1.5 py-2 px-3 bg-background/80 overflow-x-auto no-scrollbar w-full'>
      <Select
        value={selectedStatus}
        onValueChange={(value) => setSelectedStatus(value as SourceStatusFilter)}>
        <SelectTrigger className='w-[140px]' size='sm' variant='outline'>
          <SelectValue placeholder='Status' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>All Status</SelectItem>
          <SelectItem value='live'>Live</SelectItem>
          <SelectItem value='syncing'>Syncing</SelectItem>
          <SelectItem value='error'>Error</SelectItem>
          <SelectItem value='paused'>Paused</SelectItem>
          <SelectItem value='pending'>Pending</SelectItem>
        </SelectContent>
      </Select>

      <InputSearch value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
    </div>
  )
}
