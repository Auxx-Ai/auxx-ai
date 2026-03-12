// apps/web/src/components/workflow/share/workflow-share-provider.tsx
'use client'

import type { ContentSegment } from '@auxx/lib/workflow-engine/client'
import { createContext, type ReactNode, useContext, useRef } from 'react'
import { createStore, type StoreApi, useStore } from 'zustand'
import type { WorkflowSiteInfo } from './hooks/use-workflow-share'

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
  passport: string | null
  endUserId: string | null
  currentRun: WorkflowRun | null

  // Loading states
  isLoadingSite: boolean
  isLoadingPassport: boolean
  isExecuting: boolean

  // Error states
  siteError: string | null
  passportError: string | null
  executionError: string | null

  // Actions
  setShareToken: (token: string) => void
  setSiteInfo: (info: WorkflowSiteInfo) => void
  setPassport: (passport: string, endUserId: string) => void
  setCurrentRun: (run: WorkflowRun | null) => void
  updateRunStatus: (status: WorkflowRun['status'], error?: string) => void
  upsertEndNodeResult: (result: EndNodeResult) => void
  setLoading: (key: 'site' | 'passport' | 'executing', value: boolean) => void
  setError: (key: 'site' | 'passport' | 'execution', error: string | null) => void
  reset: () => void
}

/**
 * Initial state
 */
const initialState = {
  shareToken: null,
  siteInfo: null,
  passport: null,
  endUserId: null,
  currentRun: null,
  isLoadingSite: false,
  isLoadingPassport: false,
  isExecuting: false,
  siteError: null,
  passportError: null,
  executionError: null,
}

/**
 * Create workflow share store
 */
const createWorkflowShareStore = () =>
  createStore<WorkflowShareState>((set) => ({
    ...initialState,

    setShareToken: (token) => set({ shareToken: token }),

    setSiteInfo: (info) => set({ siteInfo: info, siteError: null }),

    setPassport: (passport, endUserId) => set({ passport, endUserId, passportError: null }),

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
      const loadingKey =
        key === 'site' ? 'isLoadingSite' : key === 'passport' ? 'isLoadingPassport' : 'isExecuting'
      set({ [loadingKey]: value })
    },

    setError: (key, error) => {
      const errorKey =
        key === 'site' ? 'siteError' : key === 'passport' ? 'passportError' : 'executionError'
      set({ [errorKey]: error })
    },

    reset: () => set(initialState),
  }))

type WorkflowShareStore = StoreApi<WorkflowShareState>

const WorkflowShareContext = createContext<WorkflowShareStore | null>(null)

/**
 * Provider for workflow share store
 */
export function WorkflowShareProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<WorkflowShareStore | undefined>(undefined)

  if (!storeRef.current) {
    storeRef.current = createWorkflowShareStore()
  }

  return (
    <WorkflowShareContext.Provider value={storeRef.current}>
      {children}
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
