// apps/web/src/components/activity-log/ui/activity-log-view.tsx
// Org-admin "Account Activity" view: a logs-page-style filter bar (Category, date range,
// search, refresh) over the shared <AuditTable>. Filter state is controlled by the parent
// route so the SettingsPage header export button can read the same filters.

'use client'

import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABELS } from '@auxx/lib/audit-log/client'
import { Button } from '@auxx/ui/components/button'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { InputSearch } from '@auxx/ui/components/input-search'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { type AuditFeedFilters, useAuditFeed } from '../hooks/use-audit-feed'
import { AuditTable } from './audit-table'

interface ActivityLogViewProps {
  filters: AuditFeedFilters
  category: string
  onCategoryChange: (value: string) => void
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
}

/** The Account Activity feed (org admins): filter bar + paginated audit table. */
export function ActivityLogView({
  filters,
  category,
  onCategoryChange,
  dateRange,
  onDateRangeChange,
}: ActivityLogViewProps) {
  const [search, setSearch] = useState('')
  const { rows, isLoading, isRefetching, isLoadingMore, hasMore, loadMore, refresh } = useAuditFeed(
    {
      scope: 'org',
      filters,
      search,
    }
  )

  return (
    <div className='flex flex-col flex-1 overflow-hidden'>
      <div className='flex items-center flex-row w-full p-3 gap-2 border-b'>
        <div className='flex items-center min-w-[200px]'>
          <Select value={category} onValueChange={onCategoryChange}>
            <SelectTrigger className='w-full' size='sm'>
              <SelectValue placeholder='All categories' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All categories</SelectItem>
              {AUDIT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {AUDIT_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex items-center w-[250px]'>
          <DateRangePicker
            value={dateRange}
            onChange={onDateRangeChange}
            showShortLabel
            triggerClassName='w-full'
            triggerVariant='outline'
          />
        </div>
        <div className='flex items-center min-w-[240px] flex-1'>
          <InputSearch
            placeholder='Search loaded events'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className='flex items-center shrink-0'>
          <Button
            variant='outline'
            size='icon-sm'
            onClick={refresh}
            loading={isLoading || isRefetching}>
            <RefreshCw />
          </Button>
        </div>
      </div>
      <AuditTable
        rows={rows}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        columns='org'
        hasActiveSearch={!!search.trim()}
      />
    </div>
  )
}
