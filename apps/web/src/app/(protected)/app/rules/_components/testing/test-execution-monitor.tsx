// apps/web/src/app/(protected)/app/rules/_components/testing/test-execution-monitor.tsx
'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Progress } from '@auxx/ui/components/progress'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { useTestingContext } from './testing-provider'

interface TestExecutionMonitorProps {
  runId: string
  onClose?: () => void
}

export function TestExecutionMonitor({ runId, onClose }: TestExecutionMonitorProps) {
  const { currentRun } = useTestingContext()
  const [showDetails, setShowDetails] = useState(false)

  // Get detailed test run status
  const { data: runStatus, refetch } = api.testCase.getRunStatus.useQuery(
    { runId },
    {
      refetchInterval: currentRun?.status === 'RUNNING' ? 2000 : false,
      enabled: !!runId,
    }
  )

  // Get test results
  const { data: testResults } = api.testCase.getRunResults.useQuery(
    { runId },
    { enabled: !!runId && showDetails }
  )

  if (!runStatus) {
    return null
  }

  const progress = runStatus.summary
    ? ((runStatus.summary.passed + runStatus.summary.failed) / runStatus.summary.total) * 100
    : 0

  const statusIcon = {
    PENDING: <Clock className="h-5 w-5 text-gray-400" />,
    RUNNING: <Clock className="h-5 w-5 text-blue-600 animate-pulse" />,
    COMPLETED: <CheckCircle className="h-5 w-5 text-green-600" />,
    FAILED: <XCircle className="h-5 w-5 text-red-600" />,
    CANCELLED: <AlertCircle className="h-5 w-5 text-gray-600" />,
  }[runStatus.status] || <Clock className="h-5 w-5 text-gray-400" />

  const statusColor =
    {
      PENDING: 'text-gray-600',
      RUNNING: 'text-blue-600',
      COMPLETED: 'text-green-600',
      FAILED: 'text-red-600',
      CANCELLED: 'text-gray-600',
    }[runStatus.status] || 'text-gray-600'

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {statusIcon}
            <div>
              <CardTitle className="text-lg">Test Run #{runStatus.id.slice(-6)}</CardTitle>
              <p className={`text-sm ${statusColor}`}>{runStatus.status.toLowerCase()}</p>
            </div>
          </div>

          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              ×
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Bar */}
        {runStatus.status === 'RUNNING' && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Summary Stats */}
        {runStatus.summary && (
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{runStatus.summary.total}</p>
              <p className="text-sm text-muted-foreground">Total</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{runStatus.summary.passed}</p>
              <p className="text-sm text-muted-foreground">Passed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{runStatus.summary.failed}</p>
              <p className="text-sm text-muted-foreground">Failed</p>
            </div>
          </div>
        )}

        {/* Execution Details */}
        {runStatus.status !== 'PENDING' && (
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm text-muted-foreground">
              Started: {new Date(runStatus.startedAt).toLocaleTimeString()}
              {runStatus.completedAt && (
                <span className="ml-4">
                  Completed: {new Date(runStatus.completedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? 'Hide' : 'Show'} Details
            </Button>
          </div>
        )}

        {/* Test Results Details */}
        {showDetails && testResults && (
          <div className="space-y-2 border-t pt-4">
            <h4 className="font-medium">Test Results</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {testResults.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center justify-between p-2 border rounded-md">
                  <div className="flex items-center gap-2">
                    {result.passed ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-sm font-medium">{result.testCase.name}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={result.passed ? 'default' : 'destructive'}>
                      {result.passed ? 'PASS' : 'FAIL'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{result.executionTime}ms</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Message */}
        {runStatus.status === 'FAILED' && runStatus.results?.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800">
              <strong>Error:</strong> {runStatus.results.error}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
