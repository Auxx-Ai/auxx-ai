// apps/web/src/app/(protected)/app/workflows/_components/stats/workflows-stats-cards.tsx
'use client'

import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { CheckCircle, Play, TrendingUp, Workflow } from 'lucide-react'
import { useWorkflows } from '../providers/workflows-provider'

export function WorkflowsStatsCards() {
  const { stats, isLoading } = useWorkflows()

  const cards: StatCardData[] = [
    {
      title: 'Total Workflows',
      body: stats?.total || 0,
      description: stats ? `${stats.enabled} enabled, ${stats.disabled} disabled` : '',
      icon: <Workflow className='size-4' />,
      color: 'text-blue-500',
    },
    {
      title: 'Active Workflows',
      body: stats?.enabled || 0,
      description: 'Currently enabled',
      icon: <Play className='size-4' />,
      color: 'text-comparison-500',
    },
    {
      title: 'Success Rate',
      body: stats ? `${stats.successRate}%` : '0%',
      description: 'Recent executions',
      icon: <CheckCircle className='size-4' />,
      color: 'text-good-500',
    },
    {
      title: 'Total Executions',
      body: stats?.totalExecutions || 0,
      description: 'All time',
      icon: <TrendingUp className='size-4' />,
      color: 'text-fuchsia-500',
    },
  ]

  return (
    <StatCards
      cards={cards}
      loading={isLoading}
      columns={{
        default: 'grid-cols-2',
        md: 'md:grid-cols-4',
      }}
      className='border-b bg-primary-50'
    />
  )
}
