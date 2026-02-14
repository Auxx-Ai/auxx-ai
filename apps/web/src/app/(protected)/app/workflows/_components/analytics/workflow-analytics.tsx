import { Button } from '@auxx/ui/components/button'
import { Calendar } from '@auxx/ui/components/calendar'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Progress } from '@auxx/ui/components/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { format, startOfMonth, startOfQuarter, startOfYear, subMonths, subWeeks } from 'date-fns'
import { Activity, CalendarIcon, CheckCircle, Clock, Zap } from 'lucide-react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { TooltipExplanation } from '~/components/global/tooltip'
import { api } from '~/trpc/react'

// apps/web/src/app/(protected)/app/workflows/_components/analytics/workflow-analytics.tsx

type WorkflowAnalyticsProps = { workflowId: string }

type DateRange = { from: Date; to: Date }

// Chart configurations for different chart types
const chartConfigs = {
  executions: { data: { label: 'Executions', color: 'hsl(220, 98%, 61%)' } },
  tokens: { data: { label: 'Tokens', color: 'hsl(38, 92%, 50%)' } },
  successRate: { data: { label: 'Success Rate', color: 'hsl(142, 76%, 36%)' } },
  executionTime: { data: { label: 'Execution Time', color: 'hsl(262, 83%, 58%)' } },
} satisfies Record<string, ChartConfig>

type TimeFrame =
  | 'today'
  | 'last7days'
  | 'last4weeks'
  | 'last3months'
  | 'last12months'
  | 'monthToDate'
  | 'quarterToDate'
  | 'yearToDate'
  | 'allTime'
  | 'custom'

/**
 * AnalyticsStore interface for managing workflow analytics state
 */
interface AnalyticsStore {
  timeFrame: TimeFrame
  dateRange: DateRange
  timeFrameLabel: string
  setTimeFrame: (timeFrame: TimeFrame) => void
  setDateRange: (dateRange: DateRange) => void
  handleTimeFrameChange: (value: TimeFrame) => void
}

/**
 * Helper function to calculate time frame label
 */
const calculateTimeFrameLabel = (timeFrame: TimeFrame, dateRange: DateRange): string => {
  // Special cases that don't show date ranges
  if (timeFrame === 'today') {
    return 'Today'
  }
  if (timeFrame === 'allTime') {
    return 'All time'
  }

  // If same month and year, show abbreviated format
  if (
    dateRange.from.getMonth() === dateRange.to.getMonth() &&
    dateRange.from.getFullYear() === dateRange.to.getFullYear()
  ) {
    const fromDay = format(dateRange.from, 'd')
    const toDay = format(dateRange.to, 'd')
    const month = format(dateRange.from, 'MMM')
    const year = dateRange.to.getFullYear()
    return `${month} ${fromDay}-${toDay}, ${year}`
  }

  // Different months or years
  const fromFormatted = format(dateRange.from, 'MMM d, yyyy')
  const toFormatted = format(dateRange.to, 'MMM d, yyyy')
  return `${fromFormatted} - ${toFormatted}`
}

/**
 * Zustand store for workflow analytics state management
 */
const useAnalyticsStore = create<AnalyticsStore>()(
  subscribeWithSelector((set, get) => {
    const initialDateRange = { from: subWeeks(new Date(), 1), to: new Date() }
    const initialTimeFrame: TimeFrame = 'last7days'

    return {
      timeFrame: initialTimeFrame,
      dateRange: initialDateRange,
      timeFrameLabel: calculateTimeFrameLabel(initialTimeFrame, initialDateRange),
      setTimeFrame: (timeFrame) => {
        const { dateRange } = get()
        const newLabel = calculateTimeFrameLabel(timeFrame, dateRange)
        set({ timeFrame, timeFrameLabel: newLabel })
      },
      setDateRange: (dateRange) => {
        const { timeFrame } = get()
        const newLabel = calculateTimeFrameLabel(timeFrame, dateRange)
        set({ dateRange, timeFrameLabel: newLabel })
      },
      handleTimeFrameChange: (value) => {
        const now = new Date()
        let newDateRange: DateRange

        if (value === 'today') {
          newDateRange = { from: now, to: now }
        } else if (value === 'last7days') {
          newDateRange = { from: subWeeks(now, 1), to: now }
        } else if (value === 'last4weeks') {
          newDateRange = { from: subWeeks(now, 4), to: now }
        } else if (value === 'last3months') {
          newDateRange = { from: subMonths(now, 3), to: now }
        } else if (value === 'last12months') {
          newDateRange = { from: subMonths(now, 12), to: now }
        } else if (value === 'monthToDate') {
          newDateRange = { from: startOfMonth(now), to: now }
        } else if (value === 'quarterToDate') {
          newDateRange = { from: startOfQuarter(now), to: now }
        } else if (value === 'yearToDate') {
          newDateRange = { from: startOfYear(now), to: now }
        } else if (value === 'allTime') {
          newDateRange = { from: new Date('2020-01-01'), to: now }
        } else {
          // For 'custom', keep existing dateRange
          newDateRange = get().dateRange
        }

        const newLabel = calculateTimeFrameLabel(value, newDateRange)
        set({ timeFrame: value, dateRange: newDateRange, timeFrameLabel: newLabel })
      },
    }
  })
)

/**
 * WorkflowAnalytics
 * Analytics component for workflow analytics section with real-time data.
 */
function WorkflowAnalytics({ workflowId }: WorkflowAnalyticsProps) {
  const timeFrame = useAnalyticsStore((state) => state.timeFrame)
  const dateRange = useAnalyticsStore((state) => state.dateRange)

  // Fetch detailed statistics
  const {
    data: detailedStats,
    isLoading,
    error,
  } = api.workflow.getDetailedStats.useQuery(
    {
      workflowId,
      timeRange: timeFrame,
      customDateRange: timeFrame === 'custom' ? dateRange : undefined,
    },
    { placeholderData: keepPreviousData }
  )

  return (
    <>
      <WorkflowAnalyticsOptions />
      <WorkflowAnalyticsHeader detailedStats={detailedStats} loading={isLoading} />
      <div className='flex-1 overflow-y-auto overflow-hidden rounded-b-lg'>
        <div className='grid grid-cols-1 md:grid-cols-2 border-b'>
          <WorkflowAnalyticsChart
            title='Total Executions'
            description='Total number of executions in the workflow over time.'
            chartType='executions'
            data={detailedStats?.executionsOverTime}
            loading={isLoading}
            error={error?.message}
            className='border-r sm:border-r-0 sm:border-b md:border-r md:border-b-0'
          />
          <WorkflowAnalyticsChart
            title='Token Usage'
            description='Total tokens used per time period in the workflow.'
            chartType='tokens'
            data={detailedStats?.tokenUsageOverTime}
            loading={isLoading}
            error={error?.message}
          />
        </div>
        <div className='grid md:grid-cols-2 border-b'>
          <WorkflowAnalyticsChart
            title='Success Rate'
            description='Percentage of successful executions over time.'
            chartType='successRate'
            data={detailedStats?.successRateOverTime}
            loading={isLoading}
            error={error?.message}
            className='border-r sm:border-r-0 sm:border-b md:border-r md:border-b-0'
          />
          <WorkflowAnalyticsChart
            title='Avg Execution Time'
            description='Average execution time per time period.'
            chartType='executionTime'
            data={detailedStats?.avgExecutionTimeOverTime}
            loading={isLoading}
            error={error?.message}
          />
        </div>
      </div>
    </>
  )
}

function WorkflowAnalyticsOptions() {
  const timeFrame = useAnalyticsStore((state) => state.timeFrame)
  const dateRange = useAnalyticsStore((state) => state.dateRange)
  const handleTimeFrameChange = useAnalyticsStore((state) => state.handleTimeFrameChange)
  const setDateRange = useAnalyticsStore((state) => state.setDateRange)

  return (
    <div className='flex items-center p-1 bg-primary-150 border-b border-primary-300 rounded-t-lg'>
      <div className='flex items-center gap-2'>
        <Select value={timeFrame} onValueChange={handleTimeFrameChange}>
          <SelectTrigger className='w-[140px]' size='sm'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='today'>Today</SelectItem>
            <SelectItem value='last7days'>Last 7 days</SelectItem>
            <SelectItem value='last4weeks'>Last 4 weeks</SelectItem>
            <SelectItem value='last3months'>Last 3 months</SelectItem>
            <SelectItem value='last12months'>Last 12 months</SelectItem>
            <SelectItem value='monthToDate'>Month to date</SelectItem>
            <SelectItem value='quarterToDate'>Quarter to date</SelectItem>
            <SelectItem value='yearToDate'>Year to date</SelectItem>
            <SelectItem value='allTime'>All time</SelectItem>
            <SelectItem value='custom'>Custom Range</SelectItem>
          </SelectContent>
        </Select>
        {timeFrame === 'custom' && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='outline' size='sm' className='justify-start text-left font-normal'>
                <CalendarIcon className='mr-2 h-4 w-4' />
                {format(dateRange.from, 'PPP')} - {format(dateRange.to, 'PPP')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='start'>
              <Calendar
                mode='range'
                selected={dateRange}
                onSelect={(range) => range && setDateRange(range as DateRange)}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}

interface WorkflowDetailedStats {
  summary: {
    totalExecutions: number
    totalTokens: number
    avgSuccessRate: number
    avgExecutionTime: number
  }
}

interface WorkflowAnalyticsHeaderProps {
  detailedStats?: WorkflowDetailedStats
  loading?: boolean
}

function WorkflowAnalyticsHeader({ detailedStats, loading }: WorkflowAnalyticsHeaderProps) {
  const summary = detailedStats?.summary

  const cards: StatCardData[] = [
    {
      color: 'text-comparison-500',
      className: 'border-b md:border-b-0',
      title: 'Total Executions',
      icon: <Zap className='size-4' />,
      iconPosition: 'right',
      body: loading ? '--' : summary?.totalExecutions?.toLocaleString() || 0,
      description: (
        <div className='flex items-center gap-1 text-xs'>
          <Activity className='h-3 w-3 text-primary-400' />
          Workflow runs
        </div>
      ),
    },
    {
      color: 'text-accent-500',
      className: 'border-b md:border-b-0',
      title: 'Total Tokens',
      icon: <Activity className='size-4' />,
      iconPosition: 'right',
      body: loading ? '--' : summary?.totalTokens?.toLocaleString() || 0,
      description: (
        <div className='flex items-center gap-1 text-xs'>
          <Activity className='h-3 w-3 text-primary-400' />
          AI tokens used
        </div>
      ),
    },
    {
      title: 'Success Rate',
      color: 'text-fuchsia-500',
      icon: <CheckCircle className='size-4' />,
      iconPosition: 'right',
      body: loading ? '--' : `${summary?.avgSuccessRate?.toFixed(1) || 0}%`,
      description: <Progress value={summary?.avgSuccessRate || 0} className='mt-2' />,
    },
    {
      title: 'Avg Execution Time',
      color: 'text-good-500',
      icon: <Clock className='size-4' />,
      iconPosition: 'right',
      body: loading ? '--' : `${summary?.avgExecutionTime || 0}ms`,
      description: (
        <div className='flex items-center gap-1 text-xs'>
          <Clock className='h-3 w-3 text-primary-400' />
          Per execution
        </div>
      ),
    },
  ]

  return (
    <StatCards
      cards={cards}
      loading={loading}
      columns={{ default: 'grid-cols-2', md: 'md:grid-cols-4' }}
      className='border-b bg-primary-50'
    />
  )
}

type ChartType = 'executions' | 'tokens' | 'successRate' | 'executionTime'

interface TimeSeriesDataPoint {
  timestamp: Date
  date: string
  value: number
}

type WorkflowAnalyticsChartProps = {
  title: string
  description: string
  chartType: ChartType
  data?: TimeSeriesDataPoint[]
  loading?: boolean
  error?: string
  className?: string
}

function WorkflowAnalyticsChart({
  title,
  description,
  chartType,
  data = [],
  loading = false,
  error,
  className,
}: WorkflowAnalyticsChartProps) {
  const timeFrameLabel = useAnalyticsStore((state) => state.timeFrameLabel)

  // Transform data for recharts
  const chartData = data.map((point) => ({ date: point.date, data: point.value }))

  const chartConfig = chartConfigs[chartType]

  // Format value based on chart type
  const formatValue = (value: number) => {
    switch (chartType) {
      case 'executions':
        return value.toString()
      case 'tokens':
        return value.toLocaleString()
      case 'successRate':
        return `${value.toFixed(1)}%`
      case 'executionTime':
        return `${value}ms`
      default:
        return value.toString()
    }
  }
  if (loading) {
    return (
      <div
        className={cn(
          'group bg-background hover:bg-primary-50 transition-colors duration-200 p-3',
          className
        )}>
        <div className='mb-3'>
          <div className='flex grow items-center'>
            <div className='w-full'>
              <div className='font-semibold gap-1 text-sm uppercase flex flex-row items-center text-primary-400 group-hover:text-primary-500'>
                <div className='min-w-0 overflow-hidden text-ellipsis break-normal'>{title}</div>
                {description && (
                  <TooltipExplanation text={description} className='text-primary-400' />
                )}
              </div>
              <div className='text-xs uppercase text-primary-400'>{timeFrameLabel}</div>
            </div>
          </div>
        </div>
        <div className='min-h-[200px] max-h-[300px] w-full flex items-center justify-center'>
          <div className='text-primary-400'>Loading...</div>
        </div>
      </div>
    )
  }

  // if (error) {
  //   return (
  //     <div className="group bg-background hover:bg-primary-50 transition-colors duration-200 p-3">
  //       <div className="mb-3">
  //         <div className="flex grow items-center">
  //           <div className="w-full">
  //             <div className="font-semibold gap-1 text-sm uppercase flex flex-row items-center text-primary-400 group-hover:text-primary-500">
  //               <div className="min-w-0 overflow-hidden text-ellipsis break-normal">{title}</div>
  //               {description && (
  //                 <TooltipExplanation text={description} className="text-primary-400" />
  //               )}
  //             </div>
  //             <div className="text-xs uppercase text-primary-400">{timeFrameLabel}</div>
  //           </div>
  //         </div>
  //       </div>
  //       <div className="min-h-[200px] w-full flex items-center justify-center">
  //         <div className="text-red-500">Error loading data</div>
  //       </div>
  //     </div>
  //   )
  // }

  return (
    <div
      className={cn(
        'group bg-background hover:bg-primary-50 transition-colors duration-200 p-3',
        className
      )}>
      <div className='mb-3'>
        <div className='flex grow items-center'>
          <div className='w-full'>
            <div className='font-semibold gap-1 text-sm uppercase flex flex-row items-center text-primary-400 group-hover:text-primary-500'>
              <div className='min-w-0 overflow-hidden text-ellipsis break-normal'>{title}</div>
              {description && (
                <TooltipExplanation text={description} className='text-primary-400' />
              )}
            </div>
            <div className='text-xs uppercase text-primary-400'>{timeFrameLabel}</div>
          </div>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className='min-h-[200px] max-h-[300px] w-full flex items-center justify-center'>
          <div className='text-primary-400'>No data available</div>
        </div>
      ) : (
        <ChartContainer config={chartConfig} className='min-h-[200px] max-h-[350px] w-full'>
          <LineChart accessibilityLayer data={chartData} margin={{ left: 10, right: 10 }}>
            <CartesianGrid vertical={false} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={formatValue} />
            <XAxis
              dataKey='date'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => value.split(',')[0]} // Show just the date part
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value) => [formatValue(Number(value)), ` ${chartConfig.data.label}`]}
                />
              }
            />
            <Line
              dataKey='data'
              type='natural'
              stroke={chartConfig.data.color}
              strokeWidth={2}
              dot={{ fill: chartConfig.data.color }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ChartContainer>
      )}
    </div>
  )
}

export { WorkflowAnalytics }
