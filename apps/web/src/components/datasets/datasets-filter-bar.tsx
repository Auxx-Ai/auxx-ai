// apps/web/src/components/datasets/filters/datasets-filter-bar.tsx

'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { ViewModeToggle } from '@auxx/ui/components/view-mode-toggle'
import { useDatasets } from './datasets-provider'

/**
 * Filter bar component with search, status filter, and view mode toggles
 */
export function DatasetsFilterBar() {
  const { searchQuery, setSearchQuery, selectedStatus, setSelectedStatus, viewMode, setViewMode } =
    useDatasets()

  return (
    <ListToolbar>
      {/* Status Filter */}
      <ListToolbarGroup>
        <Select value={selectedStatus} onValueChange={(value: any) => setSelectedStatus(value)}>
          <SelectTrigger className='w-[140px]' size='sm' variant='outline'>
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Status</SelectItem>
            <SelectItem value='ACTIVE'>Active</SelectItem>
            <SelectItem value='PROCESSING'>Processing</SelectItem>
            <SelectItem value='ERROR'>Error</SelectItem>
            <SelectItem value='INACTIVE'>Archived</SelectItem>
          </SelectContent>
        </Select>
      </ListToolbarGroup>

      {/* Search */}
      <InputSearch value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />

      <ListToolbarGroup align='end'>
        <ViewModeToggle value={viewMode} onValueChange={setViewMode} />
      </ListToolbarGroup>
    </ListToolbar>
  )
}
