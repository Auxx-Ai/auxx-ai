// apps/web/src/app/(protected)/app/rules/_components/testing/test-run-detail.tsx
'use client'

import { useMemo } from 'react'
import { format, formatDistanceToNow, differenceInMilliseconds } from 'date-fns'
import {
  CheckCircle,
  XCircle,
  Clock,
  Timer,
  Activity,
  TrendingUp,
  AlertCircle,
  FileText,
  Target,
  Zap,
  Code,
  User,
  Calendar,
  Hash,
  Package,
  ChevronRight,
  X,
  FlaskConical,
} from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Progress } from '@auxx/ui/components/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@auxx/ui/components/accordion'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerOverlay,
  DrawerTrigger,
} from '@auxx/ui/components/drawer'
import { DialogTitle } from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'

// Types matching the parent component
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

interface TestRunDetailProps {
  run: TestRun
  open: boolean
  onOpenChange: () => void
}

// Component for test run header with basic info and status
function TestRunHeader({ run, successRate }: { run: TestRun; successRate: number }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">Test Run Details</h3>
          <Badge variant="outline" className="font-mono">
            <Hash className="h-3 w-3 mr-1" />
            {run.id.slice(-8)}
          </Badge>
        </div>
        {run.suite && (
          <p className="text-sm text-muted-foreground mt-1">Test Suite: {run.suite.name}</p>
        )}
      </div>
      <Badge
        variant={
          run.status === 'COMPLETED'
            ? successRate === 100
              ? 'default'
              : 'secondary'
            : run.status === 'FAILED'
              ? 'destructive'
              : run.status === 'RUNNING'
                ? 'secondary'
                : 'outline'
        }
        className="text-sm">
        {run.status}
      </Badge>
    </div>
  )
}

// Component for the metrics cards grid
function TestRunMetrics({
  run,
  successRate,
  duration,
  avgExecutionTime,
  minExecutionTime,
  maxExecutionTime,
}: {
  run: TestRun
  successRate: number
  duration: number | null
  avgExecutionTime: number
  minExecutionTime: number
  maxExecutionTime: number
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3">
      {/* Success Rate Card */}
      <div className="border-r border-b">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">{successRate}%</span>
            {successRate === 100 ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : successRate > 50 ? (
              <AlertCircle className="h-4 w-4 text-yellow-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
          </div>
          <Progress value={successRate} className="mt-2 h-2" />
        </CardContent>
      </div>

      {/* Test Results Card */}
      <div className="border-r border-b">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Test Results</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="font-semibold text-green-600">{run.summary.passed}</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1">
              <XCircle className="h-4 w-4 text-red-600" />
              <span className="font-semibold text-red-600">{run.summary.failed}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">of {run.summary.total} total</p>
        </CardContent>
      </div>

      {/* Duration Card */}
      <div className="border-b border-r md:border-r-0">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Duration</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <span className="text-xl font-semibold">
              {duration ? `${(duration / 1000).toFixed(1)}s` : 'Running...'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Avg: {Math.round(avgExecutionTime)}ms
          </p>
        </CardContent>
      </div>

      {/* Performance Card */}
      <div className="border-r border-b">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Min:</span>
              <span className="font-medium">{minExecutionTime}ms</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Max:</span>
              <span className="font-medium">{maxExecutionTime}ms</span>
            </div>
          </div>
        </CardContent>
      </div>

      {/* Executed By Card */}
      <div className="col-span-2 border-b">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Executed By</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{run.executedBy.name}</p>
              <p className="text-xs text-muted-foreground truncate">{run.executedBy.email}</p>
            </div>
          </div>
        </CardContent>
      </div>
    </div>
  )
}

// Component for individual test result details
function TestResultDetails({ result }: { result: TestResult }) {
  return (
    <AccordionContent className="px-4 pb-4">
      <div className="space-y-3">
        {/* Error Message */}
        {result.errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-medium text-red-900 mb-1">Error Message:</p>
            <code className="text-sm text-red-800 font-mono">{result.errorMessage}</code>
          </div>
        )}

        {/* Matched Rules */}
        {result.actualRules && (
          <div>
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <Target className="h-4 w-4" />
              Matched Rules
            </p>
            <div className="flex flex-wrap gap-2">
              {Array.isArray(result.actualRules) ? (
                result.actualRules.map((ruleId, idx) => (
                  <Badge key={idx} variant="secondary" className="font-mono text-xs">
                    {typeof ruleId === 'string' ? ruleId : JSON.stringify(ruleId)}
                  </Badge>
                ))
              ) : (
                <pre className="text-xs bg-muted p-2 rounded">
                  {JSON.stringify(result.actualRules, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Executed Actions */}
        {result.actualActions && (
          <div>
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Executed Actions
            </p>
            <div className="space-y-1">
              {Array.isArray(result.actualActions) ? (
                result.actualActions.length > 0 ? (
                  result.actualActions.map((action, idx) => (
                    <div key={idx} className="p-2 bg-muted rounded text-sm font-mono">
                      {JSON.stringify(action, null, 2)}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No actions executed</p>
                )
              ) : (
                <pre className="text-xs bg-muted p-2 rounded">
                  {JSON.stringify(result.actualActions, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Test Details */}
        <div className="pt-2 border-t">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Test Case ID:</span>
              <span className="ml-2 font-mono">{result.testCaseId.slice(-8)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Result ID:</span>
              <span className="ml-2 font-mono">{result.id.slice(-8)}</span>
            </div>
          </div>
        </div>
      </div>
    </AccordionContent>
  )
}

// Component for the detailed results tabs
function TestResultsTabs({
  run,
  failedResults,
  passedResults,
}: {
  run: TestRun
  failedResults: TestResult[]
  passedResults: TestResult[]
}) {
  return (
    <Tabs defaultValue={failedResults.length > 0 ? 'failed' : 'all'} className="w-full flex-1">
      <TabsList className="text-foreground mb-0 h-auto gap-2 rounded-none border-b bg-primary-100 px-0 py-1 w-full">
        <TabsTrigger value="all" variant="outline" size="sm">
          <Activity className="h-4 w-4 -ms-0.5 me-1.5 opacity-60" />
          All Tests ({run.testResults.length})
        </TabsTrigger>
        <TabsTrigger
          value="failed"
          variant="outline"
          disabled={failedResults.length === 0}
          size="sm">
          <XCircle className="h-4 w-4 -ms-0.5 me-1.5 opacity-60" />
          Failed ({failedResults.length})
        </TabsTrigger>
        <TabsTrigger value="passed" variant="outline" size="sm">
          <CheckCircle className="h-4 w-4 -ms-0.5 me-1.5 opacity-60" />
          Passed ({passedResults.length})
        </TabsTrigger>
      </TabsList>

      {/* All Tests Tab */}
      <TabsContent value="all" className="p-3">
        <Accordion type="single" collapsible className="space-y-2">
          {run.testResults.map((result, index) => (
            <AccordionItem key={result.id} value={`item-${index}`} className="border rounded-lg">
              <AccordionTrigger className="hover:no-underline px-4">
                <div className="flex items-center justify-between w-full mr-2">
                  <div className="flex items-center gap-3">
                    {result.passed ? (
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                    )}
                    <div className="text-left">
                      <p className="font-medium">{result.testCase.name}</p>
                      {result.testCase.description && (
                        <p className="text-sm text-muted-foreground">
                          {result.testCase.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={result.passed ? 'default' : 'destructive'}>
                      {result.passed ? 'PASS' : 'FAIL'}
                    </Badge>
                    <Badge variant="outline">
                      <Zap className="h-3 w-3 mr-1" />
                      {result.executionTime}ms
                    </Badge>
                  </div>
                </div>
              </AccordionTrigger>
              <TestResultDetails result={result} />
            </AccordionItem>
          ))}
        </Accordion>
      </TabsContent>

      {/* Failed Tests Tab */}
      <TabsContent value="failed" className="p-3">
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {failedResults.map((result) => (
              <Card key={result.id} className="border-red-200 bg-red-50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <XCircle className="h-5 w-5 text-red-600" />
                        <p className="font-medium text-red-900">{result.testCase.name}</p>
                      </div>
                      {result.testCase.description && (
                        <p className="text-sm text-red-700 mb-2">{result.testCase.description}</p>
                      )}
                      {result.errorMessage && (
                        <div className="mt-2 p-2 bg-red-100 rounded">
                          <code className="text-sm text-red-800 font-mono">
                            {result.errorMessage}
                          </code>
                        </div>
                      )}
                    </div>
                    <Badge variant="destructive">{result.executionTime}ms</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      {/* Passed Tests Tab */}
      <TabsContent value="passed" className="p-3">
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-2">
            {passedResults.map((result) => (
              <div
                key={result.id}
                className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="font-medium">{result.testCase.name}</p>
                    {result.testCase.description && (
                      <p className="text-sm text-muted-foreground">{result.testCase.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="default">PASS</Badge>
                  <Badge variant="outline">{result.executionTime}ms</Badge>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )
}

// Component for execution timeline
function ExecutionTimeline({
  formattedStartDate,
  formattedCompletedDate,
  runTimeDistance,
}: {
  formattedStartDate: string
  formattedCompletedDate: string | null
  runTimeDistance: string | null
}) {
  return (
    <div className="border-t">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Calendar className="size-4" />
          Execution Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3 pt-0">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Started:</span>
            <span className="font-medium">{formattedStartDate}</span>
          </div>
          {formattedCompletedDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completed:</span>
              <span className="font-medium">{formattedCompletedDate}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Run Time:</span>
            <span className="font-medium">{runTimeDistance || 'In Progress...'}</span>
          </div>
        </div>
      </CardContent>
    </div>
  )
}

// Component for no data state
function NoDataState({ run }: { run: TestRun | null }) {
  if (!run) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>No test run data available</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="text-center">
        <p className="text-muted-foreground mb-4">
          No detailed test results available for this run.
        </p>
        {run.summary && (
          <div className="inline-flex flex-col gap-2 text-left">
            <div className="flex gap-4">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-medium">{run.summary.total || 0}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-muted-foreground">Passed:</span>
              <span className="font-medium text-green-600">{run.summary.passed || 0}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-muted-foreground">Failed:</span>
              <span className="font-medium text-red-600">{run.summary.failed || 0}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Inner component for the main content
function TestRunDetailInner({ run }: { run: TestRun }) {
  // Ensure we have valid data before rendering
  if (!run) {
    return <NoDataState run={null} />
  }

  // Check if we have test results - they might be in results field or need to be fetched separately
  const hasTestResults = run.testResults && run.testResults.length > 0

  if (!hasTestResults) {
    return <NoDataState run={run} />
  }

  // Memoize all calculations to prevent unnecessary re-computations
  const {
    duration,
    failedResults,
    passedResults,
    avgExecutionTime,
    minExecutionTime,
    maxExecutionTime,
    successRate,
    formattedStartDate,
    formattedCompletedDate,
    runTimeDistance,
  } = useMemo(() => {
    // Safely parse dates
    const startDate = run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt)
    const endDate = run.completedAt
      ? run.completedAt instanceof Date
        ? run.completedAt
        : new Date(run.completedAt)
      : null

    const calculatedDuration = endDate ? differenceInMilliseconds(endDate, startDate) : null

    const failed = run.testResults.filter((result) => !result.passed)
    const passed = run.testResults.filter((result) => result.passed)

    const avgExec =
      run.testResults.length > 0
        ? run.testResults.reduce((sum, result) => sum + result.executionTime, 0) /
          run.testResults.length
        : 0

    const minExec =
      run.testResults.length > 0 ? Math.min(...run.testResults.map((r) => r.executionTime)) : 0

    const maxExec =
      run.testResults.length > 0 ? Math.max(...run.testResults.map((r) => r.executionTime)) : 0

    const rate =
      run.summary.total > 0 ? Math.round((run.summary.passed / run.summary.total) * 100) : 0

    // Format dates with error handling
    let startFormatted = 'Invalid date'
    let endFormatted = null
    let runTime = null

    try {
      if (startDate && !isNaN(startDate.getTime())) {
        startFormatted = format(startDate, 'MMM d, yyyy HH:mm:ss')
      }
      if (endDate && !isNaN(endDate.getTime())) {
        endFormatted = format(endDate, 'MMM d, yyyy HH:mm:ss')
        runTime = formatDistanceToNow(startDate, { addSuffix: false, includeSeconds: true })
      }
    } catch (error) {
      console.error('Error formatting dates:', error)
    }

    return {
      duration: calculatedDuration,
      failedResults: failed,
      passedResults: passed,
      avgExecutionTime: avgExec,
      minExecutionTime: minExec,
      maxExecutionTime: maxExec,
      successRate: rate,
      formattedStartDate: startFormatted,
      formattedCompletedDate: endFormatted,
      runTimeDistance: runTime,
    }
  }, [run])

  return (
    <>
      <TestRunMetrics
        run={run}
        successRate={successRate}
        duration={duration}
        avgExecutionTime={avgExecutionTime}
        minExecutionTime={minExecutionTime}
        maxExecutionTime={maxExecutionTime}
      />

      {/* <div className="flex-1 h-full"> */}
      {/* <TestRunHeader run={run} successRate={successRate} /> */}
      <TestResultsTabs run={run} failedResults={failedResults} passedResults={passedResults} />
      <ExecutionTimeline
        formattedStartDate={formattedStartDate}
        formattedCompletedDate={formattedCompletedDate}
        runTimeDistance={runTimeDistance}
      />
      {/* </div> */}
    </>
  )
}

export function TestRunDetail({ run, open, onOpenChange }: TestRunDetailProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right" modal={false}>
      <DrawerOverlay className="bg-transparent" />
      <DrawerContent>
        <DialogTitle className="flex items-center font-normal justify-between h-[53px] border-b bg-black/5 dark:bg-black/80 px-1">
          <div className="flex items-center space-x-2 px-2">
            <FlaskConical className="size-4" />
            <div className="text-sm">Test Run Details</div>
            <Badge variant="secondary" className="font-mono border-neutral-300">
              <Hash className="h-3 w-3 mr-1" />
              {run.id.slice(-8)}
            </Badge>
          </div>
          <div className="flex items-center space-x-2">
            <DrawerClose asChild>
              <Button variant="outline" size="sm" className="rounded-full w-7 h-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
        </DialogTitle>
        <div className="flex-1 overflow-y-auto h-full flex flex-col">
          <TestRunDetailInner run={run} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
