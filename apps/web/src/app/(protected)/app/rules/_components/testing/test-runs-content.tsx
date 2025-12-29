// apps/web/src/app/(protected)/app/rules/_components/testing/test-runs-content.tsx
'use client'

import { useState, useMemo } from 'react'
import { formatDistanceToNow, format, differenceInMilliseconds } from 'date-fns'
import {
  CheckCircle,
  XCircle,
  Clock,
  Download,
  RefreshCw,
  AlertCircle,
  Activity,
  Timer,
  TrendingUp,
  Play,
  User,
  Calendar,
  Eye,
  Filter,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Progress } from '@auxx/ui/components/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import {
  DynamicTable,
  type ExtendedColumnDef,
  type BulkAction,
  TableToolbar,
} from '~/components/dynamic-table'
import { useTestingContext, type ExportFormat } from './testing-provider'
import { api } from '~/trpc/react'
import { TestRunDetail } from './test-run-detail'
import { Tooltip } from '~/components/global/tooltip'

// Types for test runs and results
interface TestRun {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  startedAt: Date
  completedAt?: Date | null
  summary: { total: number; passed: number; failed: number; executionTime?: number }
  executedBy: { id: string; name: string; email: string }
  suite?: { id: string; name: string } | null
  testResults: TestResult[]
}

interface TestResult {
  id: string
  testCaseId: string
  passed: boolean
  executionTime: number
  actualRules: any // JSON field from database
  actualActions: any // JSON field from database
  errorMessage?: string | null
  testCase: { id: string; name: string; description?: string | null }
}

const testRunsColumns: ExtendedColumnDef<TestRun>[] = [
  {
    accessorKey: 'id',
    id: 'id',
    header: 'Run ID',
    columnType: 'text',
    enableSorting: true,
    minSize: 100,
    maxSize: 150,
    cell: ({ row }) => <div className="font-mono text-sm">#{row.original.id.slice(-6)}</div>,
  },
  {
    accessorKey: 'status',
    id: 'status',
    header: 'Status',
    columnType: 'select',
    enableSorting: true,
    enableFiltering: true,
    cell: ({ row }) => {
      const status = row.original.status
      const variant =
        status === 'COMPLETED'
          ? 'default'
          : status === 'FAILED'
            ? 'destructive'
            : status === 'RUNNING'
              ? 'secondary'
              : 'outline'

      return (
        <div className="flex items-center gap-2">
          {status === 'COMPLETED' && <CheckCircle className="h-4 w-4 text-green-600" />}
          {status === 'FAILED' && <XCircle className="h-4 w-4 text-red-600" />}
          {status === 'RUNNING' && <Clock className="h-4 w-4 text-blue-600 animate-pulse" />}
          {status === 'CANCELLED' && <AlertCircle className="h-4 w-4 text-gray-600" />}
          {status === 'PENDING' && <Clock className="h-4 w-4 text-gray-400" />}
          <Badge variant={variant}>{status.toLowerCase()}</Badge>
        </div>
      )
    },
  },
  {
    id: 'results',
    header: 'Results',
    columnType: 'custom',
    enableSorting: false,
    cell: ({ row }) => {
      const summary = row.original.summary
      if (!summary) return <span className="text-muted-foreground">-</span>

      return (
        <div className="flex items-center gap-2">
          <span className="text-green-600 text-sm font-medium">{summary.passed}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-red-600 text-sm font-medium">{summary.failed}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground text-sm">{summary.total}</span>
        </div>
      )
    },
  },
  {
    accessorKey: 'startedAt',
    id: 'startedAt',
    header: 'Started',
    columnType: 'date',
    icon: Calendar,
    enableSorting: true,
    enableFiltering: true,
    cell: ({ row }) => {
      // Safely format date with error handling
      const startedAt = row.original.startedAt
      let formattedDate = '-'

      try {
        const date = startedAt instanceof Date ? startedAt : new Date(startedAt)
        if (!isNaN(date.getTime())) {
          formattedDate = format(date, 'MMM d, HH:mm')
        }
      } catch (error) {
        console.error('Error formatting date:', error)
      }

      return (
        <div>
          <div className="text-sm">{formattedDate}</div>
        </div>
      )
    },
  },
  {
    id: 'duration',
    header: 'Duration',
    columnType: 'custom',
    enableSorting: false,
    cell: ({ row }) => {
      const { startedAt, completedAt, status } = row.original

      if (status === 'RUNNING') {
        return (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-blue-600 animate-pulse" />
            <span className="text-sm text-blue-600">Running...</span>
          </div>
        )
      }

      if (!completedAt) return <span className="text-muted-foreground">-</span>

      let duration = 0
      try {
        const start = startedAt instanceof Date ? startedAt : new Date(startedAt)
        const end = completedAt instanceof Date ? completedAt : new Date(completedAt)
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          duration = differenceInMilliseconds(end, start)
        }
      } catch (error) {
        console.error('Error calculating duration:', error)
      }
      return <Badge variant="secondary">{Math.round(duration / 1000)}s</Badge>
    },
  },
  {
    accessorKey: 'executedBy.name',
    id: 'executedBy',
    header: 'Executed By',
    columnType: 'text',
    icon: User,
    enableSorting: true,
    enableFiltering: true,
    cell: ({ row }) => <div className="text-sm">{row.original.executedBy?.name || 'Unknown'}</div>,
  },
  // {
  //   id: 'actions',
  //   header: '',
  //   enableSorting: false,
  //   enableFiltering: false,
  //   enableResize: false,
  //   minSize: 100,
  //   maxSize: 100,
  //   cell: ({ row }) => (
  //     <Dialog>
  //       <DialogTrigger asChild>
  //         <Button variant="ghost" size="sm">
  //           <Eye className="h-4 w-4" />
  //           View Details
  //         </Button>
  //       </DialogTrigger>
  //       <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
  //         <DialogHeader>
  //           <DialogTitle>Test Run #{row.original.id.slice(-6)} Details</DialogTitle>
  //         </DialogHeader>
  //         <TestRunDetail run={row.original} />
  //       </DialogContent>
  //     </Dialog>
  //   ),
  // },
  // {
  //   id: 'actions',
  //   header: '',
  //   enableSorting: false,
  //   enableFiltering: false,
  //   enableResize: false,
  //   minSize: 100,
  //   maxSize: 100,
  //   cell: ({ row }) => (
  //     <Button
  //       variant="ghost"
  //       size="sm"
  //       onClick={(e) => {
  //         e.stopPropagation()
  //         handleOpenTestRunDetail(row.original)
  //       }}>
  //       <Eye className="h-4 w-4" />
  //       View Details
  //     </Button>
  //   ),
  // },
]

export function TestRunsContent() {
  const { runHistory, currentRun, exportResults, isLoadingTestCases } = useTestingContext()

  // State for drawer
  const [selectedTestRun, setSelectedTestRun] = useState<TestRun | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Handler to open test run detail drawer
  const handleOpenTestRunDetail = (run: TestRun) => {
    setSelectedTestRun(run)
    setIsDrawerOpen(true)
  }

  // Handler to close drawer
  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
    setSelectedTestRun(null)
  }

  // Fetch test runs with results
  const { data: testRuns, isLoading, refetch } = api.testCase.getRuns.useQuery({ limit: 50 })

  // Calculate overview stats
  const overviewStats = useMemo(() => {
    const runs = testRuns?.items || []
    const completedRuns = runs.filter(
      (run) => run.status === 'COMPLETED' || run.status === 'FAILED'
    )

    const totalRuns = runs.length
    const successfulRuns = runs.filter((run) => run.status === 'COMPLETED').length
    const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0

    const totalTests = completedRuns.reduce((sum, run) => sum + (run.summary?.total || 0), 0)
    const passedTests = completedRuns.reduce((sum, run) => sum + (run.summary?.passed || 0), 0)
    const testSuccessRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0

    const avgExecutionTime =
      completedRuns.length > 0
        ? completedRuns.reduce((sum, run) => {
            const duration =
              run.completedAt && run.startedAt
                ? differenceInMilliseconds(new Date(run.completedAt), new Date(run.startedAt))
                : 0
            return sum + duration
          }, 0) / completedRuns.length
        : 0

    return {
      totalRuns,
      successRate,
      testSuccessRate,
      avgExecutionTime,
      runningTests: runs.filter((run) => run.status === 'RUNNING').length,
    }
  }, [testRuns])

  // Define columns for the test runs table

  // Define bulk actions
  const bulkActions: BulkAction<TestRun>[] = useMemo(
    () => [
      {
        label: 'Export Selected',
        icon: Download,
        variant: 'outline',
        action: async (rows: TestRun[]) => {
          // TODO: Implement export for selected runs
          console.log(
            'Export selected runs:',
            rows.map((r) => r.id)
          )
        },
      },
    ],
    []
  )

  const handleExport = (format: ExportFormat) => {
    exportResults(format)
  }

  const handleRefresh = () => {
    refetch()
  }

  return (
    <div className="">
      {/* Current Run Alert */}
      {currentRun && (currentRun.status === 'RUNNING' || currentRun.status === 'PENDING') && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-blue-600 animate-pulse" />
              <div className="flex-1">
                <p className="font-medium text-blue-900">Test run in progress</p>
                <p className="text-sm text-blue-700">
                  Running {currentRun.summary?.total || 0} tests...
                </p>
              </div>
              <Progress value={30} className="w-32" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Runs Table */}
      <DynamicTable
        data={testRuns?.items || []}
        columns={testRunsColumns}
        tableId="test-runs"
        className="h-[600px]"
        onRowClick={(row) => handleOpenTestRunDetail(row)}
        bulkActions={bulkActions}
        enableSearch
        enableFiltering
        enableSorting
        isLoading={isLoading || isLoadingTestCases}
        getRowId={(row) => row.id}
        emptyState={
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Play className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-sm font-semibold text-foreground">No test runs</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Start running tests to see results here.
              </p>
            </div>
          </div>
        }>
        <TableToolbar>
          <Tooltip content="Export test runs">
            <Button variant="ghost" size="sm" onClick={() => handleExport('csv')}>
              <Download className="size-3" />
              <span className="hidden @lg/controls:block">Export</span>
            </Button>
          </Tooltip>
          <Tooltip content="Refresh test runs">
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <RefreshCw className="size-3" />
              <span className="hidden @lg/controls:block">Refresh</span>
            </Button>
          </Tooltip>
        </TableToolbar>
      </DynamicTable>
      {selectedTestRun && (
        <TestRunDetail run={selectedTestRun} open={isDrawerOpen} onOpenChange={handleCloseDrawer} />
      )}
    </div>
  )
}
