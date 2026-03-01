'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { InputSearch } from '@auxx/ui/components/input-search'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { addDays, endOfDay, format, startOfDay } from 'date-fns'
import { FileSearch, Loader2, RefreshCw } from 'lucide-react'
import { useParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, useOrganizations } from '~/components/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

/**
 * Logs filter state
 */
export interface LogsFilter {
  organizationSlug: string
  appDeploymentId?: string
  startTimestamp?: number
  endTimestamp?: number
  query?: string
}

/**
 * Flattened log entry (one row per console log)
 */
interface FlattenedLogEntry {
  id: string
  timestamp: Date
  logType: 'log' | 'warn' | 'error'
  message: string
  appDeploymentId: string | null
}

/**
 * Flatten app event logs into individual console log entries
 */
function flattenAppEventLogs(appEventLogs: any[]): FlattenedLogEntry[] {
  const flattened: FlattenedLogEntry[] = []

  for (const eventLog of appEventLogs) {
    const consoleLogs = eventLog.eventData?.consoleLogs || []
    const reversedLogs = [...consoleLogs].reverse()

    for (let i = 0; i < reversedLogs.length; i++) {
      const log = reversedLogs[i]
      flattened.push({
        id: `${eventLog.id}-${i}`,
        timestamp: new Date(log.timestamp),
        logType: log.level,
        message: log.message,
        appDeploymentId: eventLog.appDeploymentId,
      })
    }
  }

  return flattened
}

/**
 * Get badge variant for log type
 */
function getLogTypeBadge(logType: 'log' | 'warn' | 'error') {
  switch (logType) {
    case 'error':
      return { variant: 'red' as const, label: 'Error' }
    case 'warn':
      return { variant: 'amber' as const, label: 'Warning' }
    default:
      return { variant: 'green' as const, label: 'Info' }
  }
}

function LogsPage() {
  // Get app context from URL params
  const params = useParams<{ slug: string; app_slug: string }>()
  const slug = params.slug
  const appSlug = params['app_slug']
  const app = useApp(slug, appSlug)

  // Get user's organizations
  const organizations = useOrganizations()

  const [filter, setFilter] = useState<LogsFilter>({
    organizationSlug: organizations[0]?.slug || '',
    startTimestamp: startOfDay(addDays(new Date(), -7)).getTime(), // Default to last 7 days
    endTimestamp: endOfDay(new Date()).getTime(),
  })

  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [allLogs, setAllLogs] = useState<any[]>([])
  const [debouncedQuery, setDebouncedQuery] = useState<string | undefined>(filter.query)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(filter.query)
      // Reset cursor and logs when query changes
      setCursor(undefined)
      setAllLogs([])
    }, 500) // 500ms debounce

    return () => clearTimeout(timer)
  }, [filter.query])

  const handleDateChange = useCallback((range: DateRange) => {
    setFilter((prev) => ({
      ...prev,
      startTimestamp: range.from ? startOfDay(range.from).getTime() : undefined,
      endTimestamp: range.to ? endOfDay(range.to).getTime() : undefined,
    }))
    // Reset cursor when filter changes
    setCursor(undefined)
    setAllLogs([])
  }, [])

  // Fetch logs with tRPC query (using debounced query)
  const {
    data: logsData,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = api.logs.search.useQuery(
    {
      appId: app?.id || '',
      organizationSlug: filter.organizationSlug,
      appDeploymentId: filter.appDeploymentId,
      startTimestamp: filter.startTimestamp,
      endTimestamp: filter.endTimestamp,
      query: debouncedQuery,
      cursor,
    },
    {
      enabled: !!app?.id && !!filter.organizationSlug,
    }
  )

  // Accumulate logs when new data arrives
  React.useEffect(() => {
    if (logsData?.appEventLogs) {
      if (cursor) {
        // Append to existing logs
        setAllLogs((prev) => [...prev, ...logsData.appEventLogs])
      } else {
        // First load - replace all logs
        setAllLogs(logsData.appEventLogs)
      }
    }
  }, [logsData, cursor])

  // Flatten all accumulated logs
  const flattenedLogs = useMemo(() => {
    const flattened = flattenAppEventLogs(allLogs)

    // If there's a search query, filter the flattened logs client-side
    if (filter.query) {
      const searchLower = filter.query.toLowerCase()
      return flattened.filter((log) => {
        return (
          log.message.toLowerCase().includes(searchLower) ||
          log.logType.toLowerCase().includes(searchLower)
        )
      })
    }

    return flattened
  }, [allLogs, filter.query])

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (logsData?.nextCursor) {
      setCursor(logsData.nextCursor)
    }
  }, [logsData])

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setCursor(undefined)
    setAllLogs([])
    refetch()
  }, [refetch])

  return (
    <div className='flex flex-col flex-1 overflow-hidden'>
      <div className='flex flex-col items-start flex-1 h-full w-full'>
        <div className='flex items-center flex-row w-full justify-stretch wrap p-3 gap-2 border-b'>
          <div className='flex items-center justify-start min-w-[240px]'>
            <Select
              value={filter.organizationSlug}
              onValueChange={(value) =>
                setFilter((prev) => ({ ...prev, organizationSlug: value }))
              }>
              <SelectTrigger className='w-full' size='sm'>
                <SelectValue placeholder='Select organization' />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.slug}>
                    {org.name || org.handle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center justify-start w-[250px]'>
            <DateRangePicker
              value={{
                from: filter.startTimestamp
                  ? new Date(filter.startTimestamp)
                  : startOfDay(addDays(new Date(), -7)),
                to: filter.endTimestamp ? new Date(filter.endTimestamp) : endOfDay(new Date()),
              }}
              onChange={handleDateChange}
              showShortLabel
              triggerClassName='w-full'
              triggerVariant='outline'
            />
          </div>
          <div className='flex items-center justify-start w-[180px]'>
            {/* Version selector - versions endpoint TODO */}
            <Select
              value={filter.appDeploymentId || 'all'}
              onValueChange={(value) =>
                setFilter((prev) => ({
                  ...prev,
                  appDeploymentId: value === 'all' ? undefined : value,
                }))
              }>
              <SelectTrigger className='w-full' size='sm'>
                <SelectValue placeholder='All versions' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All versions</SelectItem>
                {/* TODO: Fetch and display actual versions from api.versions.list */}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center justify-start min-w-[240px] flex-1'>
            <InputSearch
              placeholder='Search'
              value={filter.query || ''}
              onChange={(e) => setFilter((prev) => ({ ...prev, query: e.target.value }))}
            />
          </div>
          <div className='flex items-center justify-end shrink-0 '>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={handleRefresh}
              loading={isLoading || isRefetching}>
              <RefreshCw />
            </Button>
          </div>
        </div>
        <div className='flex flex-1 flex-col overflow-hidden w-full'>
          {error && <div className='text-red-600 mb-4'>Error loading logs: {error.message}</div>}

          {flattenedLogs.length > 0 ? (
            <div className='flex flex-col flex-1 overflow-y-auto w-full'>
              <table className='w-full caption-bottom text-sm max-w-full table-fixed'>
                <TableHeader className='sticky top-0 bg-background z-10'>
                  <TableRow>
                    <TableHead className='w-[200px]'>Timestamp</TableHead>
                    <TableHead className='flex-1'>Message</TableHead>
                    <TableHead className='w-[40px]'>Ver</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flattenedLogs.map((log) => {
                    const badge = getLogTypeBadge(log.logType)
                    const versionDisplay = log.appDeploymentId
                      ? log.appDeploymentId.slice(-4)
                      : 'N/A'
                    return (
                      <TableRow key={log.id} className=' w-full'>
                        <TableCell className='font-mono text-xs w-[200px]'>
                          <div className='flex items-center gap-2'>
                            <Badge variant={badge.variant} size='xs'>
                              {badge.label}
                            </Badge>
                            <span>{format(log.timestamp, 'MMM dd, HH:mm:ss')}</span>
                          </div>
                        </TableCell>
                        <TableCell className='flex-1 font-mono overflow-hidden min-w-0'>
                          <div className='break-words'>{log.message}</div>
                        </TableCell>
                        <TableCell className='font-mono text-xs text-muted-foreground w-[40px]'>
                          {versionDisplay}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </table>

              {logsData?.hasMore && (
                <div className='flex justify-center py-4'>
                  <Button
                    variant='outline'
                    onClick={handleLoadMore}
                    loading={isLoading}
                    loadingText='Loading...'>
                    Load More
                  </Button>
                </div>
              )}
            </div>
          ) : isLoading ? (
            <Empty className='border-0 flex-1'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Loader2 className='animate-spin' />
                </EmptyMedia>
                <EmptyTitle>Loading logs...</EmptyTitle>
                <EmptyDescription>Fetching console logs from your application</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty className='border-0 flex-1'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <FileSearch />
                </EmptyMedia>
                <EmptyTitle>No logs found</EmptyTitle>
                <EmptyDescription>
                  {filter.query
                    ? 'No logs match your search criteria. Try adjusting your filters or search query.'
                    : 'No logs available for the selected time range. Try expanding the date range or check a different version.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </div>
  )
}

export default LogsPage
