// apps/web/src/components/workflow/hooks/use-workflow-save.ts

import {
  RESOURCE_OPERATION_TO_TRIGGER_TYPE,
  type ResourceTriggerOperation,
  WorkflowTriggerType as TriggerType,
} from '@auxx/lib/workflow-engine/types'
import { toastError } from '@auxx/ui/components/toast'
import { debounce } from '@auxx/utils'
import { useStoreApi } from '@xyflow/react'
import { useCallback, useEffect, useRef } from 'react'
import { api } from '~/trpc/react'
import { useCanvasStore } from '../store/canvas-store'
import { useTestInputStore } from '../store/test-input-store'
import { useVarStore } from '../store/use-var-store'
import { useWorkflowStore } from '../store/workflow-store'
import { useReadOnly } from './use-read-only'

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
    onSuccess: (updatedWorkflow) => {
      // Sync the workflow object from backend response to ensure all fields are up-to-date
      // Critically, this updates the version number which is incremented on each save
      useWorkflowStore.getState().setWorkflow(updatedWorkflow)
      markClean()
    },
  })

  /**
   * Build save payload from pending changes
   */
  const buildPayload = useCallback(() => {
    const workflow = useWorkflowStore.getState().workflow
    const metadata = useWorkflowStore.getState().metadata
    const currentIsDirty = useWorkflowStore.getState().isDirty
    const pending = pendingRef.current

    if (!workflow || !metadata || !workflowAppId) return null

    // If there are no pending changes but isDirty is true, include graph data
    // This handles cases where changes were made but not queued via queueSave
    if (Object.keys(pending).length === 0) {
      if (!currentIsDirty) return null
      // Mark graph as needing save
      pending.graph = true
    }

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

      // Compute trigger type and entityDefinitionId from node data
      const triggerNode = cleanNodes.find((n) => n.data.type === 'resource-trigger')
      let triggerType = workflow.triggerType
      let entityDefinitionId: string | undefined

      if (triggerNode) {
        const { operation, entityDefinitionId: nodeEntityDefId } = triggerNode.data

        // Use the linker to map resource operations to trigger types
        if (operation && nodeEntityDefId) {
          const mappedTriggerType =
            RESOURCE_OPERATION_TO_TRIGGER_TYPE[operation as ResourceTriggerOperation]
          if (mappedTriggerType) {
            triggerType = mappedTriggerType
            entityDefinitionId = nodeEntityDefId
          }
        }
      }

      // Other trigger types (non-resource) - use NodeType enum values aligned with backend
      const manualNode = cleanNodes.find((n) => n.data.type === 'manual')
      if (manualNode) {
        triggerType = TriggerType.FORM
        entityDefinitionId = undefined // Form triggers don't have entity
      }

      const webhookNode = cleanNodes.find((n) => n.data.type === 'webhook')
      if (webhookNode) {
        triggerType = TriggerType.WEBHOOK
        entityDefinitionId = undefined
      }

      const scheduledNode = cleanNodes.find((n) => n.data.type === 'scheduled')
      if (scheduledNode) {
        triggerType = TriggerType.SCHEDULED
        entityDefinitionId = undefined
      }

      const messageNode = cleanNodes.find((n) => n.data.type === 'message-received')
      if (messageNode) {
        triggerType = TriggerType.MESSAGE_RECEIVED
        entityDefinitionId = undefined
      }

      payload.graph = { nodes: cleanNodes, edges: cleanEdges, viewport: { x, y, zoom } }
      payload.triggerType = triggerType
      payload.entityDefinitionId = entityDefinitionId
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
    if (
      changes.icon ||
      changes.graph ||
      changes.envVars ||
      changes.webEnabled !== undefined ||
      changes.apiEnabled !== undefined ||
      changes.accessMode ||
      changes.config ||
      changes.rateLimit
    ) {
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
    (
      updates: Pick<
        PendingChanges,
        'webEnabled' | 'apiEnabled' | 'accessMode' | 'config' | 'rateLimit'
      >
    ) => queueSave(updates),
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
