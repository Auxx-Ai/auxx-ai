// apps/web/src/app/(protected)/app/workflows/_components/filters/workflows-filter-bar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { LayoutGrid, List } from 'lucide-react'
import { useWorkflows } from '../providers/workflows-provider'
import { getAllTriggers } from '../utils/trigger-info'

type ViewMode = 'grid' | 'table'

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

  const triggerTypes = getAllTriggers().map((trigger) => ({
    value: trigger.id,
    label: trigger.title,
  }))

  return (
    <div className='px-3 py-2 border-b bg-background/80'>
      <div className='flex flex-col sm:flex-row gap-1.5'>
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

        <InputSearch
          value={searchQuery}
          placeholder='Search workflows...'
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {/* <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search workflows..."
              size="sm"
              variant="secondary"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div> */}
        <div className='flex items-center space-x-2'>
          <div className='flex items-center space-x-2 h-7'>
            <Switch
              id='show-disabled'
              size='sm'
              checked={enabledFilter === false}
              onCheckedChange={(checked) => setEnabledFilter(checked ? false : null)}
            />
            <Label htmlFor='show-disabled' className='text-sm'>
              Show disabled
            </Label>
          </div>
        </div>

        <div className='items-center gap-2 md:flex hidden'>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
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
    </div>
  )
}
