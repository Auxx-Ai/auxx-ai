// apps/web/src/components/datasets/stats/datasets-stats-cards.tsx

'use client'

import { StatCards, type StatCardData } from '@auxx/ui/components/stat-card'
import { Database, FileText, AlertCircle, Activity } from 'lucide-react'
import { formatBytes } from '@auxx/utils/file'
import type { OrganizationDatasetStats } from './datasets-provider'

interface DatasetsStatsCardsProps {
  stats: OrganizationDatasetStats | null
}

/**
 * Component displaying organization-level dataset statistics in card format
 */
export function DatasetsStatsCards({ stats }: DatasetsStatsCardsProps) {
  const cards: StatCardData[] = [
    {
      title: 'Total Datasets',
      body: stats?.total.toString() || '0',
      icon: <Database className="size-4" />,
      description: stats ? `${stats.active} active, ${stats.processing} processing` : '',
      color: 'text-accent-500',
      iconPosition: 'right',
    },
    {
      title: 'Total Documents',
      body: stats?.totalDocuments.toString() || '0',
      icon: <FileText className="size-4" />,
      description: 'Across all datasets',
      color: 'text-comparison-500',
      iconPosition: 'right',
    },
    {
      title: 'Storage Used',
      body: stats ? formatBytes(Number(stats.totalSize)) : '0 B',
      icon: <Activity className="size-4" />,
      description: 'Total storage consumed',
      color: 'text-good-500',
      iconPosition: 'right',
    },
    {
      title: 'Processing Issues',
      body: stats?.error.toString() || '0',
      icon: <AlertCircle className="size-4" />,
      description: stats && stats.error > 0 ? 'Datasets with errors' : 'No issues detected',
      color: 'text-bad-500',
      iconPosition: 'right',
      // Uncomment if you want to show error color
      // color: stats && stats.error > 0 ? 'text-destructive' : undefined,
    },
  ]

  return <StatCards cards={cards} loading={!stats} />
}
