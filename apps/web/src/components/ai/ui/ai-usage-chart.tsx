// apps/web/src/components/ai/ui/ai-usage-chart.tsx

'use client'

import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@auxx/ui/components/chart'

/** Entry shape from the API */
interface UsageDayEntry {
  provider: string
  model: string
  modelType: string
  totalTokens: number
  source: string
  sourceId: string | null
  runCount: number
}

interface AiUsageChartProps {
  data: Record<string, UsageDayEntry[]>
  loading?: boolean
  stackBy?: 'provider' | 'model' | 'source'
  /** Minimum number of days to show on the chart (default: 7) */
  minDays?: number
}

/**
 * Generate an array of date strings for the last N days
 */
function getLastNDays(n: number): string[] {
  const dates: string[] = []
  const today = new Date()

  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    // Format as YYYY-MM-DD
    dates.push(date.toISOString().split('T')[0])
  }

  return dates
}

/** Chart colors using CSS variables */
const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

/**
 * Stacked bar chart for AI usage visualization
 */
export function AiUsageChart({
  data,
  loading,
  stackBy = 'provider',
  minDays = 7,
}: AiUsageChartProps) {
  // Transform data for stacked bar chart
  // Output: [{ date: "2025-12-09", openai: 1500, anthropic: 2000, ... }, ...]
  const { chartData, stackKeys, chartConfig } = useMemo(() => {
    const stackKeysSet = new Set<string>()
    const dateMap: Record<string, Record<string, number>> = {}

    // Aggregate tokens by date and stack key (provider/model/source)
    for (const [date, entries] of Object.entries(data)) {
      if (!dateMap[date]) {
        dateMap[date] = {}
      }
      for (const entry of entries) {
        const key = entry[stackBy]
        stackKeysSet.add(key)
        dateMap[date][key] = (dateMap[date][key] || 0) + entry.totalTokens
      }
    }

    // Ensure we always show at least minDays
    const lastNDays = getLastNDays(minDays)
    for (const date of lastNDays) {
      if (!dateMap[date]) {
        dateMap[date] = {}
      }
    }

    // Convert to array sorted by date
    const sortedDates = Object.keys(dateMap).sort()
    const chartData = sortedDates.map((date) => ({
      date,
      ...dateMap[date],
    }))

    const stackKeys = Array.from(stackKeysSet).sort()

    // Build chart config - assign colors from CSS variables
    const chartConfig: ChartConfig = {}
    if (stackKeys.length === 0) {
      // No data - add a placeholder config
      chartConfig['tokens'] = {
        label: 'Tokens',
        color: CHART_COLORS[0],
      }
    } else {
      stackKeys.forEach((key, index) => {
        chartConfig[key] = {
          label: key,
          color: CHART_COLORS[index % CHART_COLORS.length],
        }
      })
    }

    return { chartData, stackKeys, chartConfig }
  }, [data, stackBy, minDays])

  if (loading) {
    return (
      <div className="h-[300px] flex items-center justify-center text-primary-400">
        Loading chart...
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => {
            // Format date to "Dec 9"
            const d = new Date(value)
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => {
            // Format large numbers: 1500 -> "1.5k"
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
            if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
            return value.toString()
          }}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" className="min-w-50" />} />
        {stackKeys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="tokens"
            radius={8}
            fill={chartConfig[key]?.color || CHART_COLORS[0]}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
