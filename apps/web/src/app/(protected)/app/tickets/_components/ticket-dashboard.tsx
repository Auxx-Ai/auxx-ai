// apps/web/src/app/(protected)/app/tickets/_components/ticket-dashboard.tsx

'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { formatDistance } from 'date-fns'
import { CheckCircle, Inbox, TicketIcon, TimerIcon } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '~/trpc/react'

/** Dashboard period options */
const PERIOD_OPTIONS = ['day', 'week', 'month', 'year'] as const

/** Chart config for ticket activity (created vs resolved) */
const ticketActivityConfig: ChartConfig = {
  created: {
    label: 'Created',
    color: 'hsl(217, 91%, 60%)',
  },
  resolved: {
    label: 'Resolved',
    color: 'hsl(160, 84%, 39%)',
  },
}

/** Chart config for ticket status distribution */
const statusConfig: ChartConfig = {
  OPEN: { label: 'Open', color: 'hsl(217, 91%, 60%)' },
  IN_PROGRESS: { label: 'In Progress', color: 'hsl(38, 92%, 50%)' },
  WAITING_FOR_CUSTOMER: { label: 'Waiting for Customer', color: 'hsl(262, 83%, 58%)' },
  WAITING_FOR_THIRD_PARTY: { label: 'Waiting for Third Party', color: 'hsl(239, 84%, 67%)' },
  RESOLVED: { label: 'Resolved', color: 'hsl(160, 84%, 39%)' },
  CLOSED: { label: 'Closed', color: 'hsl(220, 9%, 46%)' },
  CANCELLED: { label: 'Cancelled', color: 'hsl(0, 84%, 60%)' },
}

/** Chart config for priority distribution */
const priorityConfig: ChartConfig = {
  LOW: { label: 'Low', color: 'hsl(220, 9%, 64%)' },
  MEDIUM: { label: 'Medium', color: 'hsl(217, 91%, 65%)' },
  HIGH: { label: 'High', color: 'hsl(25, 95%, 53%)' },
  URGENT: { label: 'Urgent', color: 'hsl(0, 84%, 60%)' },
}

/** Chart config for ticket types */
const ticketTypesConfig: ChartConfig = {
  count: {
    label: 'Tickets',
    color: 'hsl(262, 83%, 58%)',
  },
}

/**
 * Dashboard content component - displays ticket analytics and metrics
 * Reads period from URL query param (set by layout header)
 */
export function TicketDashboardContent() {
  const [period] = useQueryState('period', parseAsStringLiteral(PERIOD_OPTIONS).withDefault('week'))

  const { data: summaryData, isLoading } = api.ticket.dashboard.useQuery({ period })

  // Transform status data for pie chart
  const statusData = Object.entries(summaryData?.ticketsByStatus || {}).map(([status, count]) => ({
    status,
    name: status.replace(/_/g, ' '),
    value: count,
    fill: statusConfig[status]?.color || 'hsl(220, 9%, 46%)',
  }))

  // Transform priority data for bar chart
  const priorityData = Object.entries(summaryData?.ticketsByPriority || {}).map(
    ([priority, count]) => ({
      name: priority,
      count,
      fill: priorityConfig[priority]?.color || 'hsl(220, 9%, 46%)',
    })
  )

  // Transform ticket types data for bar chart
  const ticketTypesData =
    summaryData?.topTicketTypes.map((item) => ({
      name: item.type.replace(/_/g, ' '),
      count: item.count,
    })) || []

  // Stats cards data
  const statsCards: StatCardData[] = [
    {
      title: 'Total Open Tickets',
      body:
        (summaryData?.ticketsByStatus?.OPEN || 0) +
        (summaryData?.ticketsByStatus?.IN_PROGRESS || 0) +
        (summaryData?.ticketsByStatus?.WAITING_FOR_CUSTOMER || 0) +
        (summaryData?.ticketsByStatus?.WAITING_FOR_THIRD_PARTY || 0),
      description: 'Active tickets',
      icon: <Inbox className='size-4' />,
      color: 'text-blue-500',
    },
    {
      title: 'New Tickets',
      body: summaryData?.newTicketsCount || 0,
      description: `Last ${period}`,
      icon: <TicketIcon className='size-4' />,
      color: 'text-indigo-500',
    },
    {
      title: 'Resolved Tickets',
      body: summaryData?.resolvedTicketsCount || 0,
      description: `Last ${period}`,
      icon: <CheckCircle className='size-4' />,
      color: 'text-good-500',
    },
    {
      title: 'Avg Resolution Time',
      body: summaryData?.avgResolutionTime
        ? formatDistance(0, summaryData.avgResolutionTime)
        : 'N/A',
      description: `Last ${period}`,
      icon: <TimerIcon className='size-4' />,
      color: 'text-amber-500',
    },
  ]

  return (
    <div className='flex-1 overflow-y-auto relative'>
      {/* Stats cards */}
      <StatCards
        cards={statsCards}
        loading={isLoading}
        columns={{
          default: 'grid-cols-2',
          lg: 'lg:grid-cols-4',
        }}
        className='border-b bg-primary-100 sticky top-0 z-10'
      />

      {/* Charts section */}
      <div className='grid grid-cols-1 gap-3 md:grid-cols-2 p-3 border-b bg-primary-50'>
        {isLoading ? (
          <>
            <Card className='bg-primary-100'>
              <CardHeader>
                <Skeleton className='h-6 w-48' />
              </CardHeader>
              <CardContent className='h-80'>
                <Skeleton className='h-full w-full' />
              </CardContent>
            </Card>

            <Card className='bg-primary-100'>
              <CardHeader>
                <Skeleton className='h-6 w-48' />
              </CardHeader>
              <CardContent className='h-80'>
                <Skeleton className='h-full w-full' />
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {/* Ticket Activity Chart */}
            <Card className='bg-primary-100'>
              <CardHeader>
                <CardTitle>Ticket Activity</CardTitle>
                <CardDescription>Created vs. Resolved tickets over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={ticketActivityConfig} className='h-72 w-full'>
                  <AreaChart
                    data={summaryData?.ticketsOverTime || []}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey='date' tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Area
                      type='monotone'
                      dataKey='created'
                      stroke='var(--color-created)'
                      fill='var(--color-created)'
                      fillOpacity={0.3}
                      strokeWidth={2}
                    />
                    <Area
                      type='monotone'
                      dataKey='resolved'
                      stroke='var(--color-resolved)'
                      fill='var(--color-resolved)'
                      fillOpacity={0.3}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Tickets by Status Chart */}
            <Card className='bg-primary-100'>
              <CardHeader>
                <CardTitle>Tickets by Status</CardTitle>
                <CardDescription>Current ticket distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={statusConfig} className='h-72 w-full'>
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={statusData}
                      cx='50%'
                      cy='50%'
                      outerRadius={100}
                      dataKey='value'
                      nameKey='name'
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false}>
                      {statusData.map((entry) => (
                        <Cell key={entry.status} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Bottom section */}
      <div className='grid grid-cols-1 gap-3 lg:grid-cols-3 p-3'>
        {isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className='h-6 w-40' />
                </CardHeader>
                <CardContent>
                  <Skeleton className='h-60 w-full' />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            {/* Tickets by Priority Chart */}
            <Card>
              <CardHeader className='border-b'>
                <CardTitle className='font-normal text-sm'>Tickets by Priority</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={priorityConfig} className='h-52 w-full'>
                  <BarChart
                    data={priorityData}
                    layout='vertical'
                    barCategoryGap='20%'
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type='number' tickLine={false} axisLine={false} />
                    <YAxis
                      dataKey='name'
                      type='category'
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 14 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey='count' maxBarSize={24} radius={4}>
                      {priorityData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Top Ticket Types Chart */}
            <Card>
              <CardHeader className='border-b'>
                <CardTitle className='font-normal text-sm'>Top Ticket Types</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={ticketTypesConfig} className='h-52 w-full'>
                  <BarChart
                    data={ticketTypesData}
                    layout='vertical'
                    barCategoryGap='20%'
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type='number' tickLine={false} axisLine={false} />
                    <YAxis
                      dataKey='name'
                      type='category'
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 14 }}
                      width={110}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey='count' fill='var(--color-count)' maxBarSize={24} radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Attention Required Card */}
            <Card className='flex flex-col'>
              <CardHeader className='border-b'>
                <CardTitle className='font-normal text-sm'>Attention Required</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-1 min-h-0 p-0'>
                <div className='flex-1 min-h-0 flex flex-col'>
                  <div className='flex items-center justify-between border-b ps-3 pe-5 flex-1'>
                    <div className='flex items-center gap-2'>
                      <EntityIcon iconId='alert-triangle' color='amber' variant='muted' />
                      <span className='text-sm'>Due Today</span>
                    </div>
                    <div className='text-lg font-semibold text-right'>
                      {summaryData?.dueTodayCount || 0}
                    </div>
                  </div>

                  <div className='flex items-center justify-between border-b ps-3 pe-5 flex-1'>
                    <div className='flex items-center gap-2'>
                      <EntityIcon iconId='clock' color='red' variant='muted' />
                      <span className='text-sm'>Overdue</span>
                    </div>
                    <div className='text-lg font-semibold'>{summaryData?.overdueCount || 0}</div>
                  </div>

                  <div className='flex items-center justify-between ps-3 pe-5 flex-1'>
                    <div className='flex items-center gap-2'>
                      <EntityIcon iconId='help-circle' color='blue' variant='muted' />
                      <span className='text-sm'>Unassigned</span>
                    </div>
                    <div className='text-lg font-semibold'>
                      {summaryData?.unassignedTicketsCount || 0}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

/** @deprecated Use TicketDashboardContent instead */
export default function TicketDashboard() {
  return <TicketDashboardContent />
}
