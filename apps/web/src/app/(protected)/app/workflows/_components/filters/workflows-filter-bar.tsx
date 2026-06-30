// apps/web/src/app/(protected)/app/workflows/_components/filters/workflows-filter-bar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { Label } from '@auxx/ui/components/label'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { ViewModeToggle } from '@auxx/ui/components/view-mode-toggle'
import { useBulkMode, useListSelection } from '~/components/list-selection'
import { useWorkflows } from '../providers/workflows-provider'
import { getAllTriggers } from '../utils/trigger-info'

export function WorkflowsFilterBar() {
  const {
    searchQuery,
    setSearchQuery,
    selectedTriggerType,
    setSelectedTriggerType,
    enabledFilter,
    setEnabledFilter,
    viewMode,
    setViewMode,
  } = useWorkflows()

  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)

  const triggerTypes = getAllTriggers().map((trigger) => ({
    value: trigger.id,
    label: trigger.title,
  }))

  return (
    <ListToolbar>
      <ListToolbarGroup className='hidden sm:flex'>
        <Select
          value={selectedTriggerType || 'ALL'}
          onValueChange={(value) => setSelectedTriggerType(value === 'ALL' ? null : value)}>
          <SelectTrigger className='w-[180px]' size='sm' variant='outline'>
            <SelectValue placeholder='Filter by trigger' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='ALL'>All Triggers</SelectItem>
            {triggerTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ListToolbarGroup>

      <InputSearch
        value={searchQuery}
        placeholder='Search workflows...'
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <ListToolbarGroup align='end'>
        {viewMode === 'grid' && <ListBulkToggle active={bulkMode} onActiveChange={setBulkMode} />}
        <div className='flex items-center space-x-2 h-7'>
          <Switch
            id='show-disabled'
            size='sm'
            checked={enabledFilter === false}
            onCheckedChange={(checked) => setEnabledFilter(checked ? false : null)}
          />
          <Label htmlFor='show-disabled' className='text-sm whitespace-nowrap hidden sm:block'>
            Show disabled
          </Label>
        </div>
        <ViewModeToggle value={viewMode} onValueChange={setViewMode} className='hidden md:block' />
      </ListToolbarGroup>
    </ListToolbar>
  )
}
