// apps/web/src/app/(protected)/app/rules/_components/testing/testing-provider.tsx
'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'

// Define types locally to avoid import issues
type TestCaseStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT'
type TestRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

// Types
export interface TestCase {
  id: string
  name: string
  description?: string | null
  email: any
  expectedRules: any
  expectedActions: any
  tags: string[]
  version: number
  status: TestCaseStatus
  createdAt: Date
  updatedAt: Date
  organizationId: string
  createdById: string
}

export interface TestRun {
  id: string
  suiteId?: string | null
  status: TestRunStatus
  startedAt: Date
  completedAt?: Date | null
  results: any
  summary: any
  executedById: string
  organizationId: string
}

export interface TestFilters {
  status?: TestCaseStatus
  tags?: string[]
  lastRunResult?: 'passed' | 'failed'
  createdDateFrom?: Date
  createdDateTo?: Date
  search?: string
}

export interface RunOptions {
  testCaseIds?: string[]
  suiteId?: string
  parallel?: boolean
  skipSpamDetection?: boolean
  skipInternalExternal?: boolean
  timeout?: number
}

export interface ImportSource {
  type: 'thread' | 'file' | 'template'
  data: any
}

export type ExportFormat = 'csv' | 'json' | 'pdf'

interface TestingContextType {
  // Test Cases
  testCases: TestCase[]
  selectedTestCases: Set<string>

  // Test Runs
  currentRun: TestRun | null
  runHistory: TestRun[]

  // Actions
  createTestCase: (data: Partial<TestCase>) => Promise<void>
  runTests: (options: RunOptions) => Promise<void>
  importTestCases: (source: ImportSource) => Promise<void>
  exportResults: (format: ExportFormat) => void

  // Selection
  selectTestCase: (id: string) => void
  unselectTestCase: (id: string) => void
  selectAllTestCases: () => void
  clearSelection: () => void

  // Filters & Settings
  filters: TestFilters
  setFilters: (filters: TestFilters) => void

  // Loading states
  isLoadingTestCases: boolean
  isRunningTests: boolean
}

const TestingContext = createContext<TestingContextType | undefined>(undefined)

export function useTestingContext() {
  const context = useContext(TestingContext)
  if (!context) {
    throw new Error('useTestingContext must be used within TestingProvider')
  }
  return context
}

interface TestingProviderProps {
  children: ReactNode
}

export function TestingProvider({ children }: TestingProviderProps) {
  // State
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [selectedTestCases, setSelectedTestCases] = useState<Set<string>>(new Set())
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null)
  const [runHistory, setRunHistory] = useState<TestRun[]>([])
  const [filters, setFilters] = useState<TestFilters>({})
  const [isLoadingTestCases, setIsLoadingTestCases] = useState(false)
  const [isRunningTests, setIsRunningTests] = useState(false)

  // tRPC queries
  const { data: testCasesData, isLoading } = api.testCase.list.useQuery(filters)
  const { data: runsData } = api.testCase.getRuns.useQuery({ limit: 20 })

  const createTestCaseMutation = api.testCase.create.useMutation()
  const runTestsMutation = api.testCase.run.useMutation()

  // Real-time test run monitoring
  const { data: currentRunData } = api.testCase.getRunStatus.useQuery(
    { runId: currentRun?.id || '' },
    {
      enabled: !!currentRun?.id && currentRun.status === 'RUNNING',
      refetchInterval: 2000, // Poll every 2 seconds
    }
  )

  // Update state when data changes
  useEffect(() => {
    if (testCasesData) {
      setTestCases(testCasesData as any)
    }
  }, [testCasesData])

  useEffect(() => {
    if (runsData?.items) {
      setRunHistory(runsData.items as any)
    }
  }, [runsData])

  useEffect(() => {
    setIsLoadingTestCases(isLoading)
  }, [isLoading])

  // Update current run status from real-time data
  useEffect(() => {
    if (currentRunData && currentRun) {
      setCurrentRun(currentRunData as any)

      // If run completed, stop polling and update run history
      if (currentRunData.status === 'COMPLETED' || currentRunData.status === 'FAILED') {
        setIsRunningTests(false)
        // Refetch runs list to update history
        setTimeout(() => {
          // This will trigger a refetch of the runs list
          setCurrentRun(null)
        }, 1000)
      }
    }
  }, [currentRunData, currentRun])

  // Actions
  const createTestCase = useCallback(
    async (data: Partial<TestCase>) => {
      try {
        await createTestCaseMutation.mutateAsync(data as any)
        toastSuccess({
          title: 'Test case created successfully',
          description: 'Your test case has been saved and is ready to use',
        })
      } catch (error) {
        toastError({
          title: 'Failed to create test case',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      }
    },
    [createTestCaseMutation]
  )

  const runTests = useCallback(
    async (options: RunOptions) => {
      setIsRunningTests(true)
      try {
        const result = await runTestsMutation.mutateAsync(options)
        setCurrentRun(result as any)
        toastSuccess({
          title: 'Test run started',
          description: 'Your tests are now running in the background',
        })
      } catch (error) {
        toastError({
          title: 'Failed to start test run',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsRunningTests(false)
      }
    },
    [runTestsMutation]
  )

  const importTestCases = useCallback(async (source: ImportSource) => {
    // TODO: Implement import logic
    console.log('Importing test cases:', source)
  }, [])

  const exportResults = useCallback((format: ExportFormat) => {
    // TODO: Implement export logic
    console.log('Exporting results:', format)
  }, [])

  // Selection actions
  const selectTestCase = useCallback((id: string) => {
    setSelectedTestCases((prev) => new Set(prev).add(id))
  }, [])

  const unselectTestCase = useCallback((id: string) => {
    setSelectedTestCases((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const selectAllTestCases = useCallback(() => {
    setSelectedTestCases(new Set(testCases.map((tc) => tc.id)))
  }, [testCases])

  const clearSelection = useCallback(() => {
    setSelectedTestCases(new Set())
  }, [])

  const value: TestingContextType = {
    testCases,
    selectedTestCases,
    currentRun,
    runHistory,
    createTestCase,
    runTests,
    importTestCases,
    exportResults,
    selectTestCase,
    unselectTestCase,
    selectAllTestCases,
    clearSelection,
    filters,
    setFilters,
    isLoadingTestCases,
    isRunningTests,
  }

  return <TestingContext.Provider value={value}>{children}</TestingContext.Provider>
}
