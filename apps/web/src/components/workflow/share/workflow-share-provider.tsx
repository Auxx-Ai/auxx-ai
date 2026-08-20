// apps/web/src/components/workflow/share/workflow-share-provider.tsx
'use client'

import type { ContentSegment } from '@auxx/lib/workflow-engine/client'
import { PassportProvider } from '@auxx/ui/passport'
import { createContext, type ReactNode, useCallback, useContext, useRef } from 'react'
import { createStore, type StoreApi, useStore } from 'zustand'
import { useEnv } from '~/providers/dehydrated-state-provider'
import type { WorkflowSiteInfo } from './hooks/use-workflow-share'
import { readErrorMessage } from './utils/error-message'

const WORKFLOW_PASSPORT_STORAGE_PREFIX = 'auxx_passport_workflow_'

/**
 * End node execution result
 */
export interface EndNodeResult {
  nodeId: string
  title: string
  status: 'running' | 'completed' | 'failed'
  message?: string
  contentSegments?: ContentSegment[] // Rich content with file rendering support
  error?: string
}

/**
 * Workflow run data
 */
export interface WorkflowRun {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  endNodeResults: EndNodeResult[]
}

/**
 * Share store state
 */
interface WorkflowShareState {
  // Data
  shareToken: string | null
  siteInfo: WorkflowSiteInfo | null
  currentRun: WorkflowRun | null

  // Loading states
  isLoadingSite: boolean
  isExecuting: boolean

  // Error states
  siteError: string | null
  executionError: string | null

  // Actions
  setShareToken: (token: string) => void
  setSiteInfo: (info: WorkflowSiteInfo) => void
  setCurrentRun: (run: WorkflowRun | null) => void
  updateRunStatus: (status: WorkflowRun['status'], error?: string) => void
  upsertEndNodeResult: (result: EndNodeResult) => void
  setLoading: (key: 'site' | 'executing', value: boolean) => void
  setError: (key: 'site' | 'execution', error: string | null) => void
  reset: () => void
}

/**
 * Initial state
 */
const initialState = {
  shareToken: null,
  siteInfo: null,
  currentRun: null,
  isLoadingSite: false,
  isExecuting: false,
  siteError: null,
  executionError: null,
}

/**
 * Create workflow share store
 */
const createWorkflowShareStore = (shareToken: string | null) =>
  createStore<WorkflowShareState>((set) => ({
    ...initialState,
    shareToken,

    setShareToken: (token) => set({ shareToken: token }),

    setSiteInfo: (info) => set({ siteInfo: info, siteError: null }),

    setCurrentRun: (run) => set({ currentRun: run }),

    updateRunStatus: (status, error) =>
      set((state) => ({
        currentRun: state.currentRun ? { ...state.currentRun, status, error } : null,
      })),

    upsertEndNodeResult: (result) =>
      set((state) => {
        if (!state.currentRun) return state

        const existing = state.currentRun.endNodeResults.findIndex(
          (r) => r.nodeId === result.nodeId
        )

        const newResults = [...state.currentRun.endNodeResults]
        if (existing >= 0) {
          newResults[existing] = result
        } else {
          newResults.push(result)
        }

        return {
          currentRun: {
            ...state.currentRun,
            endNodeResults: newResults,
          },
        }
      }),

    setLoading: (key, value) => {
      const loadingKey = key === 'site' ? 'isLoadingSite' : 'isExecuting'
      set({ [loadingKey]: value })
    },

    setError: (key, error) => {
      const errorKey = key === 'site' ? 'siteError' : 'executionError'
      set({ [errorKey]: error })
    },

    reset: () => set({ ...initialState, shareToken }),
  }))

type WorkflowShareStore = StoreApi<WorkflowShareState>

const WorkflowShareContext = createContext<WorkflowShareStore | null>(null)

interface WorkflowShareProviderProps {
  shareToken: string
  children: ReactNode
}

/**
 * Provider for workflow share store + passport.
 *
 * Wraps the zustand workflow-specific store and the shared {@link PassportProvider}
 * so descendants can read site info via `useWorkflowShareStore` and the passport
 * via `usePassport`.
 */
export function WorkflowShareProvider({ shareToken, children }: WorkflowShareProviderProps) {
  const { apiUrl } = useEnv()

  const storeRef = useRef<WorkflowShareStore | undefined>(undefined)
  if (!storeRef.current) {
    storeRef.current = createWorkflowShareStore(shareToken)
  }

  const fetchWorkflowPassport = useCallback(
    async (token: string) => {
      const res = await fetch(`${apiUrl}/workflows/share/${token}/passport`, {
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(readErrorMessage(body, 'You dont have access to this workflow'))
      }
      const { data } = await res.json()
      return {
        passport: data.passport as string,
        subjectId: data.endUserId as string,
        expiresAt: data.expiresAt as string,
      }
    },
    [apiUrl]
  )

  return (
    <WorkflowShareContext.Provider value={storeRef.current}>
      <PassportProvider
        scopeKey={shareToken}
        storageKeyPrefix={WORKFLOW_PASSPORT_STORAGE_PREFIX}
        fetchPassport={fetchWorkflowPassport}>
        {children}
      </PassportProvider>
    </WorkflowShareContext.Provider>
  )
}

/**
 * Hook to access workflow share store
 * IMPORTANT: Always use with selector to prevent unnecessary re-renders
 */
export function useWorkflowShareStore<T>(selector: (state: WorkflowShareState) => T): T {
  const store = useContext(WorkflowShareContext)

  if (!store) {
    throw new Error('useWorkflowShareStore must be used within WorkflowShareProvider')
  }

  return useStore(store, selector)
}
