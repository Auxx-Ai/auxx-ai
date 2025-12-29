// apps/web/src/stores/workflow-run-status-store.ts

import { create } from 'zustand'
import { generateId } from '@auxx/lib/utils'
import { createSSEConnection, type SSEConnection } from '~/lib/sse-connection'

type ResourceType = 'thread' | 'contact' | 'ticket' | 'message' | 'entity'
type RunStatus = 'running' | 'paused' | 'completed' | 'failed'

/**
 * Represents a tracked workflow run
 */
interface TrackedRun {
  runId: string
  workflowName: string
  resourceType: ResourceType
  resourceId: string
  status: RunStatus
  currentNodeTitle?: string
  startedAt: Date
  completedAt?: Date
  error?: string
  batchId?: string
  onComplete?: () => void
}

/**
 * Represents progress for a batch of workflow runs
 */
interface BatchProgress {
  batchId: string
  workflowName: string
  total: number
  running: number
  completed: number
  failed: number
  paused: number
}

/**
 * Store for managing workflow run status with SSE subscriptions
 */
interface WorkflowRunStatusStore {
  // State
  runs: Map<string, TrackedRun>
  connections: Map<string, SSEConnection>
  pendingSubscriptions: string[]

  // Single run operations
  trackRun: (run: {
    runId: string
    workflowName: string
    resourceType: ResourceType
    resourceId: string
    onComplete?: () => void
  }) => void

  // Bulk operation support
  trackBatch: (params: {
    workflowName: string
    resourceType: ResourceType
    results: Array<{ resourceId: string; workflowRunId: string }>
    onComplete?: () => void
  }) => string

  // Queries
  getRunsForResource: (resourceType: ResourceType, resourceId: string) => TrackedRun[]
  getBatchProgress: (batchId: string) => BatchProgress | null
  getActiveBatches: () => BatchProgress[]
  getActiveRuns: () => TrackedRun[]

  // Internal
  _updateRun: (runId: string, updates: Partial<TrackedRun>) => void
  _subscribeToRun: (runId: string) => void
  _unsubscribeFromRun: (runId: string) => void
  _subscribeNextFromQueue: () => void
  _cleanupCompletedRuns: () => void
}

const MAX_CONCURRENT_CONNECTIONS = 6
const CLEANUP_AFTER_MS = 30000

/** SSE events we care about */
const SSE_EVENTS = [
  'connected',
  'node-started',
  'node-finished',
  'workflow-finished',
  'workflow-completed',
  'workflow-failed',
  'workflow-paused',
  'node-paused',
]

export const useWorkflowRunStatusStore = create<WorkflowRunStatusStore>((set, get) => ({
  runs: new Map(),
  connections: new Map(),
  pendingSubscriptions: [],

  trackRun: ({ runId, workflowName, resourceType, resourceId, onComplete }) => {
    const run: TrackedRun = {
      runId,
      workflowName,
      resourceType,
      resourceId,
      status: 'running',
      startedAt: new Date(),
      onComplete,
    }

    set((state) => {
      const newRuns = new Map(state.runs)
      newRuns.set(runId, run)
      return { runs: newRuns }
    })

    get()._subscribeToRun(runId)
  },

  trackBatch: ({ workflowName, resourceType, results, onComplete }) => {
    const batchId = generateId('batch')

    set((state) => {
      const newRuns = new Map(state.runs)

      results.forEach((result, i) => {
        newRuns.set(result.workflowRunId, {
          runId: result.workflowRunId,
          workflowName,
          resourceType,
          resourceId: result.resourceId,
          status: 'running',
          startedAt: new Date(),
          batchId,
          onComplete: i === 0 ? onComplete : undefined,
        })
      })

      return { runs: newRuns }
    })

    const runIds = results.map((r) => r.workflowRunId)

    // Subscribe to first batch
    runIds.slice(0, MAX_CONCURRENT_CONNECTIONS).forEach((runId) => {
      get()._subscribeToRun(runId)
    })

    // Queue remaining runs
    if (runIds.length > MAX_CONCURRENT_CONNECTIONS) {
      set((state) => ({
        pendingSubscriptions: [
          ...state.pendingSubscriptions,
          ...runIds.slice(MAX_CONCURRENT_CONNECTIONS),
        ],
      }))
    }

    return batchId
  },

  getRunsForResource: (resourceType, resourceId) => {
    return Array.from(get().runs.values()).filter(
      (r) => r.resourceType === resourceType && r.resourceId === resourceId
    )
  },

  getBatchProgress: (batchId) => {
    const runs = Array.from(get().runs.values()).filter((r) => r.batchId === batchId)
    const firstRun = runs[0]
    if (!firstRun) return null

    return {
      batchId,
      workflowName: firstRun.workflowName,
      total: runs.length,
      running: runs.filter((r) => r.status === 'running').length,
      completed: runs.filter((r) => r.status === 'completed').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      paused: runs.filter((r) => r.status === 'paused').length,
    }
  },

  getActiveBatches: () => {
    const batchIds = new Set<string>()
    get().runs.forEach((run) => {
      if (run.batchId && run.status === 'running') {
        batchIds.add(run.batchId)
      }
    })

    return Array.from(batchIds)
      .map((id) => get().getBatchProgress(id))
      .filter(Boolean) as BatchProgress[]
  },

  getActiveRuns: () => {
    return Array.from(get().runs.values()).filter((r) => r.status === 'running')
  },

  _updateRun: (runId, updates) => {
    const run = get().runs.get(runId)
    if (!run) return

    set((state) => {
      const newRuns = new Map(state.runs)
      newRuns.set(runId, { ...run, ...updates })
      return { runs: newRuns }
    })

    // Handle completion
    if (updates.status === 'completed' || updates.status === 'failed') {
      console.log('[WorkflowRunStatus] Run completed', { runId, status: updates.status, hasBatchId: !!run.batchId, hasOnComplete: !!run.onComplete })
      get()._unsubscribeFromRun(runId)

      // Call onComplete for single runs
      if (run.onComplete && !run.batchId) {
        console.log('[WorkflowRunStatus] Calling onComplete for single run', { runId })
        run.onComplete()
      }

      // For batch runs, check if entire batch is complete
      if (run.batchId) {
        const batchProgress = get().getBatchProgress(run.batchId)
        console.log('[WorkflowRunStatus] Batch progress', { batchId: run.batchId, batchProgress })
        if (batchProgress && batchProgress.running === 0 && batchProgress.paused === 0) {
          const batchRuns = Array.from(get().runs.values()).filter(
            (r) => r.batchId === run.batchId
          )
          const runWithCallback = batchRuns.find((r) => r.onComplete)
          console.log('[WorkflowRunStatus] Calling onComplete for batch', { batchId: run.batchId, hasCallback: !!runWithCallback })
          runWithCallback?.onComplete?.()
        }
      }

      // Subscribe to next run from queue
      get()._subscribeNextFromQueue()

      // Cleanup old completed runs after delay
      setTimeout(() => get()._cleanupCompletedRuns(), CLEANUP_AFTER_MS)
    }
  },

  _subscribeNextFromQueue: () => {
    const state = get()

    if (state.connections.size >= MAX_CONCURRENT_CONNECTIONS) return
    if (state.pendingSubscriptions.length === 0) return

    const slotsAvailable = MAX_CONCURRENT_CONNECTIONS - state.connections.size
    const toSubscribe = state.pendingSubscriptions.slice(0, slotsAvailable)

    set((s) => ({
      pendingSubscriptions: s.pendingSubscriptions.slice(slotsAvailable),
    }))

    toSubscribe.forEach((runId) => {
      state._subscribeToRun(runId)
    })
  },

  _subscribeToRun: (runId) => {
    const state = get()
    if (state.connections.has(runId)) return

    // Verify run exists
    if (!state.runs.has(runId)) {
      console.warn(`[WorkflowRunStatus] Cannot subscribe to non-existent run ${runId}`)
      return
    }

    const connection = createSSEConnection({
      url: `/api/workflow/run/${runId}/events`,
      events: SSE_EVENTS,
      reconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 3,

      onEvent: (eventType, data) => {
        switch (eventType) {
          case 'connected':
            // Handle already-completed workflows
            if (data.status === 'succeeded') {
              get()._updateRun(runId, {
                status: 'completed',
                completedAt: new Date(),
                currentNodeTitle: undefined,
              })
            } else if (data.status === 'failed') {
              get()._updateRun(runId, {
                status: 'failed',
                completedAt: new Date(),
                currentNodeTitle: undefined,
              })
            } else if (data.status === 'paused') {
              get()._updateRun(runId, { status: 'paused' })
            }
            break

          case 'node-started':
          case 'node-finished':
            get()._updateRun(runId, { currentNodeTitle: data.title })
            break

          case 'workflow-finished':
            if (data.status === 'succeeded') {
              get()._updateRun(runId, {
                status: 'completed',
                completedAt: new Date(),
                currentNodeTitle: undefined,
              })
            } else if (data.status === 'failed') {
              get()._updateRun(runId, {
                status: 'failed',
                completedAt: new Date(),
                error: data.error || 'Workflow failed',
                currentNodeTitle: undefined,
              })
            }
            break

          case 'workflow-completed':
            get()._updateRun(runId, {
              status: 'completed',
              completedAt: new Date(),
              currentNodeTitle: undefined,
            })
            break

          case 'workflow-failed':
            get()._updateRun(runId, {
              status: 'failed',
              completedAt: new Date(),
              error: data?.error || 'Workflow failed',
              currentNodeTitle: undefined,
            })
            break

          case 'workflow-paused':
          case 'node-paused':
            get()._updateRun(runId, { status: 'paused' })
            break
        }
      },

      onError: (error) => {
        console.error(`[WorkflowRunStatus] SSE error for run ${runId}:`, error.message)
      },

      onStatusChange: (status) => {
        // If connection permanently failed, clean up and try next in queue
        if (status === 'error') {
          get()._unsubscribeFromRun(runId)
          get()._subscribeNextFromQueue()
        }
      },
    })

    // Store connection and start it
    set((state) => {
      const newConnections = new Map(state.connections)
      newConnections.set(runId, connection)
      return { connections: newConnections }
    })

    connection.connect()
  },

  _unsubscribeFromRun: (runId) => {
    const connection = get().connections.get(runId)
    if (connection) {
      connection.disconnect()
      set((state) => {
        const newConnections = new Map(state.connections)
        newConnections.delete(runId)
        return { connections: newConnections }
      })
    }
  },

  _cleanupCompletedRuns: () => {
    const now = Date.now()

    set((state) => {
      const newRuns = new Map(state.runs)
      state.runs.forEach((run, runId) => {
        if (run.completedAt && now - run.completedAt.getTime() > CLEANUP_AFTER_MS) {
          newRuns.delete(runId)
        }
      })
      return { runs: newRuns }
    })
  },
}))

export type { TrackedRun, BatchProgress, ResourceType, RunStatus }
