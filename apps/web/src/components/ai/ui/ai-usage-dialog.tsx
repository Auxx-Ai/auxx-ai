// apps/web/src/components/ai/ui/ai-usage-dialog.tsx

'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { StatCard } from '@auxx/ui/components/stat-card'
import { Activity, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { AiUsageChart } from './ai-usage-chart'

/** Time period options for the usage stats */
type TimePeriod = 'billing' | '7' | '30' | '90'

interface AiUsageDialogProps {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Dialog component for viewing AI usage statistics
 */
export function AiUsageDialog({ trigger, open, onOpenChange }: AiUsageDialogProps) {
  // Time period state - controls backend query
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('billing')

  // Frontend filter states
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [modelFilter, setModelFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  // Fetch usage stats
  const { data, isLoading } = api.aiIntegration.getUsageStats.useQuery(
    { days: timePeriod === 'billing' ? undefined : Number(timePeriod) },
    { enabled: open !== false }
  )

  // Extract unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    if (!data) return { providers: [], models: [], sources: [] }

    const providers = new Set<string>()
    const models = new Set<string>()
    const sources = new Set<string>()

    for (const entry of data.totalUsageForPeriod) {
      providers.add(entry.provider)
      models.add(entry.model)
      sources.add(entry.source)
    }

    return {
      providers: Array.from(providers).sort(),
      models: Array.from(models).sort(),
      sources: Array.from(sources).sort(),
    }
  }, [data])

  // Apply frontend filters to data
  const filteredData = useMemo(() => {
    if (!data) return null

    const filterEntry = (entry: (typeof data.totalUsageForPeriod)[0]) => {
      if (providerFilter !== 'all' && entry.provider !== providerFilter) return false
      if (modelFilter !== 'all' && entry.model !== modelFilter) return false
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false
      return true
    }

    // Filter statisticsByDay
    const filteredByDay: Record<string, typeof data.totalUsageForPeriod> = {}
    for (const [date, entries] of Object.entries(data.statisticsByDay)) {
      const filtered = entries.filter(filterEntry)
      if (filtered.length > 0) {
        filteredByDay[date] = filtered
      }
    }

    // Filter totalUsageForPeriod
    const filteredTotal = data.totalUsageForPeriod.filter(filterEntry)

    return {
      statisticsByDay: filteredByDay,
      totalUsageForPeriod: filteredTotal,
      periodStartAt: data.periodStartAt,
      periodEndAt: data.periodEndAt,
    }
  }, [data, providerFilter, modelFilter, sourceFilter])

  // Calculate summary stats
  const summary = useMemo(() => {
    if (!filteredData) return { totalRuns: 0, totalTokens: 0 }

    let totalRuns = 0
    let totalTokens = 0

    for (const entry of filteredData.totalUsageForPeriod) {
      totalRuns += entry.runCount
      totalTokens += entry.totalTokens
    }

    return { totalRuns, totalTokens }
  }, [filteredData])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className='max-w-4xl'>
        <DialogHeader>
          <DialogTitle>AI Usage</DialogTitle>
        </DialogHeader>

        {/* Row 1: Filters */}
        <div className='flex flex-wrap gap-2 pb-4'>
          <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as TimePeriod)}>
            <SelectTrigger className='w-[180px]' size='sm'>
              <SelectValue placeholder='Select period' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='billing'>Current billing period</SelectItem>
              <SelectItem value='7'>Last 7 days</SelectItem>
              <SelectItem value='30'>Last 30 days</SelectItem>
              <SelectItem value='90'>Last 90 days</SelectItem>
            </SelectContent>
          </Select>

          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className='w-[140px]' size='sm'>
              <SelectValue placeholder='Provider' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Providers</SelectItem>
              {filterOptions.providers.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger className='w-[160px]' size='sm'>
              <SelectValue placeholder='Model' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Models</SelectItem>
              {filterOptions.models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className='w-[140px]' size='sm'>
              <SelectValue placeholder='Source' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Sources</SelectItem>
              {filterOptions.sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Row 2: Stats Cards */}
        <div className='flex gap-2 mb-10 md:w-1/2'>
          <StatCard
            title='Total Runs'
            icon={<Zap className='size-4' />}
            body={isLoading ? '--' : summary.totalRuns.toLocaleString()}
            description='AI invocations'
            color='text-comparison-500'
            first
            loading={isLoading}
            className='flex-1 rounded-xl border bg-primary-50'
          />
          <StatCard
            title='Tokens Consumed'
            icon={<Activity className='size-4' />}
            body={isLoading ? '--' : summary.totalTokens.toLocaleString()}
            description='Total tokens used'
            color='text-accent-500'
            first
            loading={isLoading}
            className='flex-1 rounded-xl border bg-primary-50'
          />
        </div>

        {/* Row 3: Chart */}
        <AiUsageChart
          data={filteredData?.statisticsByDay ?? {}}
          loading={isLoading}
          stackBy='provider'
        />
      </DialogContent>
    </Dialog>
  )
}
