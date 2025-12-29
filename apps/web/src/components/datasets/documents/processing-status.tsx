// apps/web/src/components/datasets/documents/processing-status.tsx

'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'
import { Progress } from '@auxx/ui/components/progress'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Activity, Clock, CheckCircle, AlertTriangle, FileText, Zap } from 'lucide-react'
import { api } from '~/trpc/react'

interface ProcessingStatusProps {
  datasetId: string
}

export function ProcessingStatus({ datasetId }: ProcessingStatusProps) {
  const { data: processingStatus, isLoading } = api.dataset.getProcessingStatus.useQuery(
    { datasetId },
    {
      refetchInterval: 5000, // Refresh every 5 seconds
      refetchIntervalInBackground: true,
    }
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Processing Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Skeleton className="h-2 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!processingStatus) {
    return null
  }

  const {
    queuedJobs,
    activeJobs,
    completedJobs,
    failedJobs,
    totalDocuments,
    processedDocuments,
    estimatedTimeRemaining,
  } = processingStatus

  const totalJobs = queuedJobs + activeJobs + completedJobs + failedJobs
  const completionPercentage = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 100
  const hasActiveProcessing = queuedJobs > 0 || activeJobs > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Processing Status
          {hasActiveProcessing && (
            <Badge variant="secondary" className="animate-pulse">
              Active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Processing Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {/* Queued Jobs */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-full">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{queuedJobs}</p>
              <p className="text-sm text-muted-foreground">Queued</p>
            </div>
          </div>

          {/* Active Jobs */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-full">
              <Zap className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeJobs}</p>
              <p className="text-sm text-muted-foreground">Processing</p>
            </div>
          </div>

          {/* Completed Jobs */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-full">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedJobs}</p>
              <p className="text-sm text-muted-foreground">Completed</p>
            </div>
          </div>

          {/* Failed Jobs */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-full">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{failedJobs}</p>
              <p className="text-sm text-muted-foreground">Failed</p>
            </div>
          </div>
        </div>

        {/* Overall Progress */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Overall Progress</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                {processedDocuments} of {totalDocuments} documents
              </span>
              <span>{Math.round(completionPercentage)}%</span>
            </div>
          </div>

          <Progress value={completionPercentage} className="h-2" />

          {estimatedTimeRemaining && hasActiveProcessing && (
            <p className="text-sm text-muted-foreground text-center">
              Estimated time remaining: {estimatedTimeRemaining}
            </p>
          )}
        </div>

        {/* Additional Info */}
        {totalJobs === 0 && (
          <div className="text-center py-4">
            <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">All processing complete</p>
          </div>
        )}

        {failedJobs > 0 && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <p className="text-sm text-red-800">
                {failedJobs} job{failedJobs !== 1 ? 's' : ''} failed during processing. Check
                individual documents for details.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
