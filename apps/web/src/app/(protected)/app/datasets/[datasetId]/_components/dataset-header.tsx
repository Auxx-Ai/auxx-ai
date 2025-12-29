// apps/web/src/app/(protected)/app/datasets/[datasetId]/_components/dataset-header.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent } from '@auxx/ui/components/card'
import { StatCards, type StatCardData } from '@auxx/ui/components/stat-card'
import {
  Database,
  FileText,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  Cpu,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useDatasetDetail } from './dataset-detail-provider'
import { formatBytes } from '@auxx/lib/utils'

export function DatasetHeader() {
  const { dataset, documents, isLoading } = useDatasetDetail()

  if (isLoading || !dataset) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-2/3" />
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <CheckCircle className="size-4" />
      case 'PROCESSING':
        return <Clock className="size-4" />
      case 'ERROR':
        return <AlertCircle className="size-4" />
      default:
        return <Database className="size-4" />
    }
  }

  const documentCount = documents.length
  const processingCount = documents.filter((doc) => doc.status === 'PROCESSING').length
  const errorCount = documents.filter((doc) => doc.status === 'FAILED').length

  const statusDescription =
    dataset.status === 'ACTIVE'
      ? 'Ready'
      : dataset.status === 'PROCESSING'
        ? 'Processing documents'
        : dataset.status === 'ERROR'
          ? 'Has errors'
          : 'Dataset is inactive'

  const documentsDescription =
    processingCount > 0
      ? `${processingCount} processing`
      : errorCount > 0
        ? `${errorCount} with errors`
        : 'All processed'

  const cards: StatCardData[] = [
    {
      className: '',
      title: 'Status',
      body: dataset.status.toLowerCase(),
      description: statusDescription,
      icon: getStatusIcon(dataset.status),
      color:
        dataset.status === 'ACTIVE'
          ? 'text-green-500'
          : dataset.status === 'ERROR'
            ? 'text-red-500'
            : 'text-yellow-500',
    },
    {
      className: '',
      title: 'Documents',
      body: documentCount,
      description: documentsDescription,
      icon: <FileText className="size-4" />,
      color: 'text-accent-500',
    },
    {
      className: '',
      title: 'Storage',
      body: formatBytes(dataset.totalSize || 0n),
      description: 'Total size used',
      icon: <Database className="size-4" />,
      color: 'text-purple-500',
    },
    {
      className: '@md:hidden @lg:block',
      title: 'Created',
      body: <span className="text-base">{formatDistanceToNow(new Date(dataset.createdAt))}</span>,
      description: `By ${dataset.createdBy?.name || 'Unknown'}`,
      icon: <Calendar className="size-4" />,
      color: 'text-orange-500',
    },
    {
      className: '@md:hidden @xl:block',
      title: 'Configuration',
      body: (
        <div className="text-xs space-y-1">
          <div className="">{dataset.embeddingModel || 'N/A'}</div>
        </div>
      ),
      // description: 'Chunking & embedding model',
      icon: <Cpu className="size-4" />,
      color: 'text-cyan-500',
    },
  ]

  return (
    <div className="@container">
      <StatCards
        cards={cards}
        className=" @sm:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4 @xl:grid-cols-5"
        loading={false}
        columns={{ default: ' ', md: ' ', lg: ' ' }}
        // className="border-b bg-primary-50"
      />
    </div>
  )
}
