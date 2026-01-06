// apps/web/src/components/workflow/hooks/use-workflow-save.ts

import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi } from '@xyflow/react'
import { debounce } from '@auxx/utils'
import { api } from '~/trpc/react'
import { useWorkflowStore } from '../store/workflow-store'
import { useVarStore } from '../store/use-var-store'
import { useCanvasStore } from '../store/canvas-store'
import { useTestInputStore } from '../store/test-input-store'
import { useReadOnly } from './use-read-only'
import { toastError } from '@auxx/ui/components/toast'
import type { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import { isValidTableId } from '@auxx/lib/resources/client'

const DEBOUNCE_MS = 5000

/** All possible pending changes */
interface PendingChanges {
  graph?: boolean
  name?: string
  description?: string
  icon?: { iconId: string; color: string }
  webEnabled?: boolean
  apiEnabled?: boolean
  accessMode?: 'public' | 'organization'
  config?: Record<string, unknown>
  rateLimit?: Record<string, unknown>
  envVars?: boolean
}

/**
 * Unified hook for all workflow save operations.
 * Accumulates pending changes and saves them together via a single tRPC mutation.
 */
export const useWorkflowSave = () => {
  const store = useStoreApi()
  const { isReadOnly } = useReadOnly()
  const pendingRef = useRef<PendingChanges>({})

  const workflowAppId = useWorkflowStore((s) => s.workflowAppId)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const markClean = useWorkflowStore((s) => s.markClean)
  const markDirty = useWorkflowStore((s) => s.markDirty)

  // Ref to store latest executeSave so debounced function can access it
  const executeSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))

  // Single tRPC mutation for all updates
  const updateMutation = api.workflow.update.useMutation({
    onError: (error) => {
      toastError({
        title: 'Failed to save',
        description: error.message,
      })
    },
    onSuccess: () => {
      markClean()
    },
  })

  /**
   * Build save payload from pending changes
   */
  const buildPayload = useCallback(() => {
    const workflow = useWorkflowStore.getState().workflow
    const metadata = useWorkflowStore.getState().metadata
    const pending = pendingRef.current

    if (!workflow || !metadata || !workflowAppId) return null
    if (Object.keys(pending).length === 0) return null

    const payload: Record<string, unknown> = { id: workflowAppId }

    // Graph data
    if (pending.graph) {
      const { nodes, edges, transform } = store.getState()
      const [x, y, zoom] = transform

      // Validation: require at least one node
      if (!nodes || nodes.length === 0) {
        console.warn('Cannot build save payload: no nodes in workflow')
        return null
      }

      // Clean nodes - remove UI-only properties (prefixed with _)
      const cleanNodes = nodes.map((node) => {
        const cleanData = Object.fromEntries(
          Object.entries(node.data || {}).filter(([key]) => !key.startsWith('_'))
        )
        return { ...node, data: cleanData }
      })

      // Clean edges - remove UI-only properties
      const cleanEdges = edges.map((edge) => {
        if (!edge.data) return edge
        const cleanData = Object.fromEntries(
          Object.entries(edge.data).filter(([key]) => !key.startsWith('_'))
        )
        return { ...edge, data: Object.keys(cleanData).length > 0 ? cleanData : undefined }
      })

      // Compute trigger type from node data
      const VALID_OPERATIONS = ['created', 'updated', 'deleted', 'manual'] as const
      const triggerNode = cleanNodes.find((n) => n.data.type === 'resource-trigger')
      let triggerType = workflow.triggerType
      let triggerConfig: Record<string, unknown> | undefined

      if (triggerNode) {
        const { resourceType, operation } = triggerNode.data
        const isValidOp =
          typeof operation === 'string' &&
          VALID_OPERATIONS.includes(operation as (typeof VALID_OPERATIONS)[number])
        const isValidRes = typeof resourceType === 'string' && resourceType.length > 0

        if (isValidRes && isValidOp) {
          if (resourceType.startsWith('entity_')) {
            triggerType = `entity-${operation}-trigger` as WorkflowTriggerType
            triggerConfig = { entitySlug: resourceType.replace('entity_', '') }
          } else if (isValidTableId(resourceType)) {
            triggerType = `${resourceType}-${operation}-trigger` as WorkflowTriggerType
          }
        }
      }

      payload.graph = { nodes: cleanNodes, edges: cleanEdges, viewport: { x, y, zoom } }
      payload.triggerType = triggerType
      payload.triggerConfig = triggerConfig
    }

    // Metadata fields
    if (pending.name !== undefined) payload.name = pending.name
    if (pending.description !== undefined) payload.description = pending.description
    if (pending.icon) payload.icon = pending.icon

    // Access settings
    if (pending.webEnabled !== undefined) payload.webEnabled = pending.webEnabled
    if (pending.apiEnabled !== undefined) payload.apiEnabled = pending.apiEnabled
    if (pending.accessMode) payload.accessMode = pending.accessMode
    if (pending.config) payload.config = pending.config
    if (pending.rateLimit) payload.rateLimit = pending.rateLimit

    // Environment variables
    if (pending.envVars) {
      payload.envVars = Array.from(useVarStore.getState().environmentVariables.values())
      payload.variables = useTestInputStore.getState().getVariablesForSave(metadata.id)
    }

    return payload
  }, [workflowAppId, store])

  /**
   * Execute save via tRPC
   */
  const executeSave = useCallback(async () => {
    if (isReadOnly) return false

    // Check for error state in workflow store
    const workflowError = useWorkflowStore.getState().error
    if (workflowError) {
      console.warn('Skipping save due to error state:', workflowError)
      return false
    }

    const payload = buildPayload()
    if (!payload) return false

    try {
      await updateMutation.mutateAsync(payload as Parameters<typeof updateMutation.mutateAsync>[0])
      pendingRef.current = {}
      return true
    } catch {
      return false
    }
  }, [buildPayload, updateMutation, isReadOnly])

  // Keep executeSaveRef updated with latest executeSave
  executeSaveRef.current = executeSave

  /**
   * Stable debounced save function - created once, calls latest executeSave via ref
   */
  const debouncedSaveRef = useRef(
    debounce(() => {
      executeSaveRef.current()
    }, DEBOUNCE_MS)
  )

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedSaveRef.current.cancel()
    }
  }, [])

  /**
   * Check if value changed from original, and clear pending if reverted to original
   */
  const hasChanged = useCallback((changes: Partial<PendingChanges>): boolean => {
    const workflow = useWorkflowStore.getState().workflow
    let hasActualChanges = false

    // For name: check if different from original
    if (changes.name !== undefined) {
      if (changes.name === workflow?.name) {
        // Reverted to original - remove from pending
        delete pendingRef.current.name
      } else {
        hasActualChanges = true
      }
    }

    // For description: check if different from original
    if (changes.description !== undefined) {
      if (changes.description === workflow?.description) {
        // Reverted to original - remove from pending
        delete pendingRef.current.description
      } else {
        hasActualChanges = true
      }
    }

    // For icon, graph, envVars, access settings - always consider as changed
    if (changes.icon || changes.graph || changes.envVars ||
        changes.webEnabled !== undefined || changes.apiEnabled !== undefined ||
        changes.accessMode || changes.config || changes.rateLimit) {
      hasActualChanges = true
    }

    return hasActualChanges
  }, [])

  /**
   * Queue changes and trigger debounced save
   */
  const queueSave = useCallback(
    (changes: Partial<PendingChanges>) => {
      if (isReadOnly) return

      // Skip if nothing actually changed
      if (!hasChanged(changes)) return

      // Merge into pending changes
      pendingRef.current = { ...pendingRef.current, ...changes }

      // Only mark dirty if not already dirty (avoid unnecessary re-renders)
      if (!useWorkflowStore.getState().isDirty) {
        markDirty()
      }

      debouncedSaveRef.current()
    },
    [isReadOnly, markDirty, hasChanged]
  )

  // Convenience methods for different save operations
  const saveGraph = useCallback(() => queueSave({ graph: true }), [queueSave])

  const saveMetadata = useCallback(
    (updates: { name?: string; description?: string }) => queueSave(updates),
    [queueSave]
  )

  const saveIcon = useCallback(
    (icon: { iconId: string; color: string }) => queueSave({ icon }),
    [queueSave]
  )

  const saveShareSettings = useCallback(
    (updates: Pick<PendingChanges, 'webEnabled' | 'apiEnabled' | 'accessMode' | 'config' | 'rateLimit'>) =>
      queueSave(updates),
    [queueSave]
  )

  const saveEnvVars = useCallback(() => queueSave({ envVars: true }), [queueSave])

  /**
   * Immediate save - bypass debounce for when user explicitly saves
   */
  const saveNow = useCallback(async () => {
    debouncedSaveRef.current.cancel()
    return executeSave()
  }, [executeSave])

  /**
   * Cancel any pending save operations
   */
  const cancelPendingSave = useCallback(() => {
    debouncedSaveRef.current.cancel()
    pendingRef.current = {}
  }, [])

  /**
   * Beacon save for page close - uses fetch for sendBeacon compatibility
   * This ensures workflow changes are saved even when the page is closed abruptly
   */
  const syncWorkflowWhenPageClose = useCallback(() => {
    // Check read-only state
    const canvasReadOnly = useCanvasStore.getState().readOnly

    // Also check run state for read-only conditions
    const { useRunStore } = require('../store/run-store')
    const runState = useRunStore.getState()
    const runStateReadOnly =
      runState.runViewMode === 'previous' || // Viewing history
      (runState.runViewMode === 'live' && runState.isRunning) // Live execution

    if (canvasReadOnly || runStateReadOnly || isReadOnly) {
      return
    }

    // Check if workflow is dirty
    const currentIsDirty = useWorkflowStore.getState().isDirty
    if (!currentIsDirty) {
      return
    }

    // Build payload (includes any pending changes)
    // For beacon save, we need to include graph data if dirty
    if (!pendingRef.current.graph) {
      pendingRef.current.graph = true
    }

    const payload = buildPayload()
    if (!payload) {
      return
    }

    // Send beacon (can't use tRPC here, must use fetch)
    const url = `/api/workflows/${workflowAppId}`
    const success = navigator.sendBeacon(url, JSON.stringify(payload))

    if (success) {
      markClean()
      pendingRef.current = {}
    }
  }, [buildPayload, workflowAppId, markClean, isReadOnly])

  /**
   * Handle visibility change events for page close detection
   */
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'hidden') {
      syncWorkflowWhenPageClose()
    }
  }, [syncWorkflowWhenPageClose])

  /**
   * Set up event listeners for page close detection
   */
  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const currentIsDirty = useWorkflowStore.getState().isDirty

      if (currentIsDirty) {
        syncWorkflowWhenPageClose()
        // Show confirmation dialog to give more time for the beacon
        e.preventDefault()
        return ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [handleVisibilityChange, syncWorkflowWhenPageClose])

  return {
    // New unified save functions
    saveGraph,
    saveMetadata,
    saveIcon,
    saveShareSettings,
    saveEnvVars,
    saveNow,
    cancelPendingSave,

    // Backwards compatibility (for existing code that uses these)
    save: saveNow,
    debouncedSave: saveGraph,
    getWorkflowSavePayload: buildPayload,
    syncWorkflowWhenPageClose,

    // State
    isDirty,
    isSaving: updateMutation.isPending,
  }
}
