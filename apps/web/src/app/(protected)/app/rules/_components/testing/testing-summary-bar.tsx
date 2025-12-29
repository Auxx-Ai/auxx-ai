// apps/web/src/app/(protected)/app/rules/_components/testing/testing-summary-bar.tsx
'use client'

import { CheckCircle, XCircle, Clock, TrendingUp, ChartLine, RotateCw } from 'lucide-react'
import { useTestingContext } from './testing-provider'
import { titleize } from '@auxx/lib/utils'
import { useMemo } from 'react'
import { differenceInMilliseconds } from 'date-fns'
import { api } from '~/trpc/react'
import { StatCards, type StatCardData } from '@auxx/ui/components/stat-card'

export function TestingSummaryBar() {
  const { testCases, runHistory } = useTestingContext()

  const { data: testRuns, isLoading, refetch } = api.testCase.getRuns.useQuery({ limit: 50 })

  // Calculate statistics
  const lastRun = runHistory[0]
  const totalRuns = runHistory.length

  // Pass/fail statistics from recent runs
  const recentRuns = runHistory.slice(0, 10)
  const passedRuns = recentRuns.filter(
    (run) => run.status === 'COMPLETED' && (!run.summary?.failed || run.summary.failed === 0)
  ).length
  const failedRuns = recentRuns.filter(
    (run) => run.status === 'FAILED' || (run.summary?.failed && run.summary.failed > 0)
  ).length

  const passRate = recentRuns.length > 0 ? Math.round((passedRuns / recentRuns.length) * 100) : 0

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

  // Coverage calculation (placeholder - would need actual rule count)
  const coveragePercentage = testCases.length > 0 ? 75 : 0

  const lastRunIcon = useMemo(() => {
    if (!lastRun) return null
    if (lastRun.status === 'COMPLETED') return <CheckCircle className="size-4 text-green-600" />
    if (lastRun.status === 'FAILED') return <XCircle className="size-4 text-red-600" />
    if (lastRun.status === 'RUNNING')
      return <Clock className="size-4 text-blue-600 animate-pulse" />
    return null
  }, [lastRun])

  const lastRunBody = useMemo(() => {
    if (!lastRun) return 'No runs yet'
    return <span className="">{titleize(lastRun.status)}</span>
  }, [lastRun])

  const cards: StatCardData[] = [
    {
      title: 'Last Run',
      color: 'text-good-500',
      icon: lastRunIcon,
      iconPosition: 'right',
      body: lastRunBody,
      description: '',
      className: 'border-b md:border-b-0',
    },
    {
      title: 'Pass Rate',
      color: 'text-comparison-500',
      icon: <ChartLine className="size-4" />,
      iconPosition: 'right',
      body: `${passRate}%`,
      description: `${passedRuns} passed, ${failedRuns} failed`,
      className: 'border-b md:border-b-0',
    },
    {
      title: 'Coverage',
      color: 'text-red-500',
      icon: <TrendingUp className="size-4 " />,
      iconPosition: 'right',
      body: `${coveragePercentage}%`,
      description: `${testCases.length} test cases`,
      className: 'border-b md:border-b-0',
    },
    {
      title: 'Total Runs',
      color: 'text-bad-500',
      icon: <RotateCw className="size-4 " />,
      iconPosition: 'right',
      body: totalRuns,
      description: 'All time',
      className: 'border-b md:border-b-0',
    },
    {
      title: 'Avg Duration',
      color: 'text-accent-500',
      icon: <Clock className="size-4 " />,
      iconPosition: 'right',
      body: `${Math.round(overviewStats.avgExecutionTime / 1000)}s`,
      description: 'Per test run',
      className: 'border-r border-l-0 md:border-l-1 md:border-r-0',
    },
  ]

  return (
    <StatCards
      cards={cards}
      columns={{
        default: 'grid-cols-2',
        md: 'md:grid-cols-5',
      }}
      className="sm:grid border-b bg-primary-50 hidden"
    />
  )
}
