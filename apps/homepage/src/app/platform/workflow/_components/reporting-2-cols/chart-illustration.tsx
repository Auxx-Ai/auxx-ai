'use client'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '~/components/ui/chart'

const chartConfig = {
  desktop: {
    label: 'Total Executions',
    color: 'var(--color-emerald-500)',
  },
  mobile: {
    label: 'Token Usage',
    color: 'var(--color-indigo-400)',
  },
} satisfies ChartConfig

const chartData = [
  { month: 'May', desktop: 56, mobile: 224 },
  { month: 'June', desktop: 56, mobile: 224 },
  { month: 'January', desktop: 126, mobile: 252 },
  { month: 'February', desktop: 205, mobile: 410 },
  { month: 'March', desktop: 200, mobile: 126 },
  { month: 'April', desktop: 400, mobile: 800 },
]

export const ChartIllustration = () => {
  return (
    <ChartContainer className='aspect-auto h-72' config={chartConfig}>
      <AreaChart
        accessibilityLayer
        data={chartData}
        margin={{
          left: 0,
          right: 0,
        }}>
        <defs>
          <linearGradient id='fillDesktop' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='var(--color-desktop)' stopOpacity={0.8} />
            <stop offset='55%' stopColor='var(--color-desktop)' stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id='fillMobile' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='var(--color-mobile)' stopOpacity={0.8} />
            <stop offset='55%' stopColor='var(--color-mobile)' stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <ChartTooltip active content={<ChartTooltipContent className='dark:bg-muted' />} />
        <XAxis dataKey='month' stroke='var(--color-muted)' />
        <Area
          strokeWidth={1}
          dataKey='mobile'
          type='natural'
          fill='url(#fillMobile)'
          fillOpacity={0.1}
          stroke='var(--color-mobile)'
          stackId='a'
        />
        <Area
          strokeWidth={1}
          dataKey='desktop'
          type='natural'
          fill='url(#fillDesktop)'
          fillOpacity={0.1}
          stroke='var(--color-desktop)'
          stackId='a'
        />
      </AreaChart>
    </ChartContainer>
  )
}
