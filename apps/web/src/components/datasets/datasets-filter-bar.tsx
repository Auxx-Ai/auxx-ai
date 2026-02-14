// apps/web/src/components/datasets/filters/datasets-filter-bar.tsx

'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { LayoutGrid, List } from 'lucide-react'
import { useDatasets } from './datasets-provider'

/**
 * Filter bar component with search, status filter, and view mode toggles
 */
export function DatasetsFilterBar() {
  const { searchQuery, setSearchQuery, selectedStatus, setSelectedStatus, viewMode, setViewMode } =
    useDatasets()

  return (
    <div className='flex items-center border-b gap-1.5 py-2 px-3 bg-background overflow-x-auto no-scrollbar w-full'>
      {/* Status Filter */}
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

      {/* Search */}
      <InputSearch value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />

      <div className='items-center gap-2'>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v)}>
          <TabsList className='h-7'>
            <TabsTrigger value='grid' className='h-5 px-1.5'>
              <LayoutGrid className='size-4' />
            </TabsTrigger>
            <TabsTrigger value='table' className='h-5 px-1.5'>
              <List className='size-4' />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
