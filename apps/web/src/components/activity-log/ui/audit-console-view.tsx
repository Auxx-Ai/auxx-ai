// apps/web/src/components/activity-log/ui/audit-console-view.tsx
// Super-admin cross-org audit console. Lives inside the "Log" tab of the admin
// Organizations page, so it fills the tab's content area. Adds Org + Visibility
// filters (over the org-admin set) and reuses the shared feed/table/export pieces.

'use client'

import type { AuditCategory, AuditVisibility } from '@auxx/lib/audit-log/client'
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  AUDIT_VISIBILITIES,
} from '@auxx/lib/audit-log/client'
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
import { addDays, endOfDay, startOfDay } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { type AuditFeedFilters, useAuditFeed } from '../hooks/use-audit-feed'
import { AuditExportButton } from './audit-export-button'
import { AuditTable } from './audit-table'

// Sentinel select values mapped to organizationId: undefined (all) / null (platform-level).
const ORG_ALL = 'all'
const ORG_PLATFORM = 'platform'

/** Cross-org audit feed for super-admins. */
export function AuditConsoleView() {
  const [org, setOrg] = useState<string>(ORG_ALL)
  const [visibility, setVisibility] = useState<string>('all')
  const [category, setCategory] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: startOfDay(addDays(new Date(), -7)),
    to: endOfDay(new Date()),
  }))

  const { data: organizations } = api.admin.getOrganizations.useQuery({ limit: 200, offset: 0 })

  const filters = useMemo<AuditFeedFilters>(
    () => ({
      organizationId: org === ORG_ALL ? undefined : org === ORG_PLATFORM ? null : org,
      visibility: visibility === 'all' ? undefined : (visibility as AuditVisibility),
      category: category === 'all' ? undefined : (category as AuditCategory),
      from: dateRange.from ? startOfDay(dateRange.from) : undefined,
      to: dateRange.to ? endOfDay(dateRange.to) : undefined,
    }),
    [org, visibility, category, dateRange]
  )

  const { rows, isLoading, isRefetching, isLoadingMore, hasMore, loadMore, refresh } = useAuditFeed(
    {
      scope: 'admin',
      filters,
      search,
    }
  )

  return (
    <div className='flex flex-col flex-1 min-h-0 overflow-hidden'>
      <div className='flex items-center flex-row w-full p-3 gap-2 border-b flex-wrap'>
        <div className='flex items-center min-w-[200px]'>
          <Select value={org} onValueChange={setOrg}>
            <SelectTrigger className='w-full' size='sm'>
              <SelectValue placeholder='All organizations' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORG_ALL}>All organizations</SelectItem>
              <SelectItem value={ORG_PLATFORM}>Platform-level</SelectItem>
              {organizations?.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name || o.handle || o.id.slice(-6)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex items-center w-[150px]'>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger className='w-full' size='sm'>
              <SelectValue placeholder='All visibility' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All visibility</SelectItem>
              {AUDIT_VISIBILITIES.map((v) => (
                <SelectItem key={v} value={v}>
                  {v === 'admin' ? 'Customer-visible' : 'Internal'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex items-center min-w-[180px]'>
          <Select value={category} onValueChange={setCategory}>
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
            onChange={setDateRange}
            showShortLabel
            triggerClassName='w-full'
            triggerVariant='outline'
          />
        </div>
        <div className='flex items-center min-w-[200px] flex-1'>
          <InputSearch
            placeholder='Search loaded events'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className='flex items-center shrink-0 gap-2'>
          <AuditExportButton scope='admin' filters={filters} />
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
        columns='admin'
        hasActiveSearch={!!search.trim()}
      />
    </div>
  )
}
