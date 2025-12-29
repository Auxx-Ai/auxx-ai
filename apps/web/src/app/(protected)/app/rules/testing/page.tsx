// apps/web/src/app/(protected)/app/rules/testing/page.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Blend, FlaskConical, Play, PlayCircle, Plus, TestTubeDiagonal } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { TestingProvider, useTestingContext } from '../_components/testing/testing-provider'
import { TestingSummaryBar } from '../_components/testing/testing-summary-bar'
import { TestSuiteContent } from '../_components/testing/test-suite-content'
import { TestRunsContent } from '../_components/testing/test-runs-content'
import { CoverageContent } from '../_components/testing/coverage-content'
import { TestExecutionMonitor } from '../_components/testing/test-execution-monitor'
import { QuickRuleTester } from '../_components/testing/quick-rule-tester'
import { cn } from '@auxx/ui/lib/utils'
import { useQueryState } from 'nuqs'

function TestingPageContent() {
  const { testCases, runHistory, runTests, currentRun } = useTestingContext()
  const [activeTab, setActiveTab] = useQueryState('tab', {
    defaultValue: 'test-suite',
    history: 'replace',
    shallow: false,
  })

  // Calculate stats
  const totalTestCases = testCases.length
  const recentRuns = runHistory.filter((run) => {
    const dayAgo = new Date()
    dayAgo.setDate(dayAgo.getDate() - 1)
    return run.startedAt > dayAgo
  }).length

  const hasFailures = runHistory.some(
    (run) => run.status === 'FAILED' || (run.summary && run.summary.failed > 0)
  )

  const handleRunAllTests = async () => {
    await runTests({
      testCaseIds: testCases.map((tc) => tc.id),
      parallel: true,
      skipSpamDetection: true,
      skipInternalExternal: true,
    })
  }

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className="flex gap-2">
            <Button onClick={handleRunAllTests} variant="outline" disabled={totalTestCases === 0}>
              <PlayCircle className="size-4" />
              <span className="hidden sm:inline">Run All Tests</span>
            </Button>
            <Link href="/app/rules/testing/new">
              <Button>
                <Plus className="size-4" />
                <span className="hidden sm:inline">Create Test</span>
              </Button>
            </Link>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem href="/app/rules" title="Rules" />
          <MainPageBreadcrumbItem href="/app/rules/testing" title="Testing" last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent className="bg-background">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="mt-0 pt-0 flex-1 h-full flex flex-col">
          {/* Tabs */}
          <TabsList className="border-b w-full justify-start rounded-b-none bg-primary-150  overflow-x-auto no-scrollbar">
            <TabsTrigger value="test-suite" variant="outline" size="sm">
              <FlaskConical className="size-4 mr-2" />
              Test Suite
              <span className="border-primary-500/50 text-primary-900 ms-1 -me-1 inline-flex h-5 max-h-full items-center rounded border px-1 font-[inherit] text-[0.625rem] font-medium">
                {totalTestCases}
              </span>
            </TabsTrigger>
            <TabsTrigger value="runs" variant="outline" size="sm">
              <Play className="size-4 mr-2" />
              Runs
              <span
                className={cn(
                  ' ms-1 -me-1 inline-flex h-5 max-h-full items-center rounded border px-1 font-[inherit] text-[0.625rem] font-medium',
                  hasFailures && 'border-destructive text-destructive'
                )}>
                {recentRuns}
              </span>
            </TabsTrigger>
            <TabsTrigger value="coverage" variant="outline" size="sm">
              <Blend className="size-4 mr-2" />
              Coverage
            </TabsTrigger>
            <TabsTrigger value="quick-test" variant="outline" size="sm">
              <TestTubeDiagonal className="size-4 mr-2" />
              Quick Test
            </TabsTrigger>
          </TabsList>

          {/* Testing Summary Bar */}
          <TestingSummaryBar />

          {/* Real-time Test Execution Monitor */}
          {currentRun && (currentRun.status === 'RUNNING' || currentRun.status === 'PENDING') && (
            <div className="mb-6">
              <TestExecutionMonitor runId={currentRun.id} />
            </div>
          )}

          <TabsContent value="test-suite" className="overflow-hidden">
            <TestSuiteContent />
          </TabsContent>

          <TabsContent value="runs" className="overflow-hidden">
            <TestRunsContent />
          </TabsContent>

          <TabsContent value="coverage" className="overflow-hidden">
            <CoverageContent />
          </TabsContent>

          <TabsContent value="quick-test" className="overflow-hidden">
            <QuickRuleTester />
          </TabsContent>
        </Tabs>
      </MainPageContent>
    </MainPage>
  )
}

export default function RulesTestingPage() {
  return (
    <TestingProvider>
      <TestingPageContent />
    </TestingProvider>
  )
}
