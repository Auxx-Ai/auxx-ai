// apps/web/src/components/datasets/hooks/use-document-processing.ts

'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { DocumentEntity as Document } from '@auxx/database/models'

/**
 * Document processing event types (client-safe constants)
 */
const DocumentEventType = {
  CONNECTED: 'connected',
  PROCESSING_STARTED: 'processing_started',
  PROCESSING_COMPLETED: 'processing_completed',
  PROCESSING_FAILED: 'processing_failed',
  EXTRACTION_STARTED: 'extraction_started',
  EXTRACTION_COMPLETED: 'extraction_completed',
  CHUNKING_STARTED: 'chunking_started',
  CHUNKING_COMPLETED: 'chunking_completed',
  EMBEDDING_STARTED: 'embedding_started',
  EMBEDDING_PROGRESS: 'embedding_progress',
  EMBEDDING_COMPLETED: 'embedding_completed',
  CONNECTION_ERROR: 'connection_error',
} as const

/**
 * Individual document processing state
 */
export interface DocumentProcessingState {
  documentId: string
  filename: string
  status: 'idle' | 'connecting' | 'processing' | 'completed' | 'failed'
  step: 'extraction' | 'chunking' | 'embedding' | null
  progress: number
  segmentCount: number
  currentSegment: number
  error: string | null
  processingTimeMs: number | null
}

/**
 * Initial state for a document
 */
const createInitialState = (documentId: string, filename: string): DocumentProcessingState => ({
  documentId,
  filename,
  status: 'idle',
  step: null,
  progress: 0,
  segmentCount: 0,
  currentSegment: 0,
  error: null,
  processingTimeMs: null,
})

/**
 * Options for the document processing hook
 */
export interface UseDocumentProcessingOptions {
  /** Dataset ID (for context, not currently used in hook logic) */
  datasetId: string
  /** Documents to monitor - hook will auto-connect SSE for PROCESSING documents */
  documents: Document[]
  /** Called when a document completes processing */
  onDocumentComplete?: (documentId: string, state: DocumentProcessingState) => void
  /** Called when a document fails processing */
  onDocumentFailed?: (documentId: string, error: string) => void
  /** Called when all currently processing documents are complete */
  onAllComplete?: () => void
}

/**
 * Return type for the hook
 */
export interface UseDocumentProcessingReturn {
  /** Map of documentId -> processing state */
  processingStates: Map<string, DocumentProcessingState>
  /** Number of documents currently processing (not completed/failed) */
  activeCount: number
  /** Aggregate progress across all processing documents (0-100) */
  overallProgress: number
  /** Whether any documents are actively processing */
  isProcessing: boolean
  /** Whether there are any documents in the processing history (for showing toast) */
  hasProcessingHistory: boolean
  /** Clear all processing states (for manual toast dismiss) */
  clearProcessingStates: () => void
}

/**
 * SSE event types to listen for
 */
const SSE_EVENTS = [
  'connected',
  'already_indexed',
  'processing_started',
  'processing_completed',
  'processing_failed',
  'extraction_started',
  'extraction_completed',
  'chunking_started',
  'chunking_completed',
  'embedding_started',
  'embedding_progress',
  'embedding_completed',
  'connection_error',
]

/**
 * Process an SSE event and return the updated state
 */
function processEvent(
  prev: DocumentProcessingState,
  eventType: string,
  data: any
): { state: DocumentProcessingState; isComplete: boolean; isFailed: boolean; error?: string } {
  let newState = { ...prev }
  let isComplete = false
  let isFailed = false
  let error: string | undefined

  switch (eventType) {
    case DocumentEventType.CONNECTED:
      if (data.status === 'INDEXED') {
        isComplete = true
        newState = { ...newState, status: 'completed', progress: 100 }
      } else if (data.status === 'FAILED') {
        isFailed = true
        error = data.error || 'Processing failed'
        newState = { ...newState, status: 'failed', error: error ?? null }
      } else {
        newState = { ...newState, status: 'connecting' }
      }
      break

    case 'already_indexed':
      isComplete = true
      newState = { ...newState, status: 'completed', progress: 100 }
      break

    case DocumentEventType.PROCESSING_STARTED:
      newState = { ...newState, status: 'processing' }
      break

    case DocumentEventType.EXTRACTION_STARTED:
      newState = { ...newState, step: 'extraction', progress: 0 }
      break

    case DocumentEventType.EXTRACTION_COMPLETED:
      newState = { ...newState, step: 'extraction', progress: 100 }
      break

    case DocumentEventType.CHUNKING_STARTED:
      newState = { ...newState, step: 'chunking', progress: 0 }
      break

    case DocumentEventType.CHUNKING_COMPLETED:
      newState = {
        ...newState,
        step: 'chunking',
        progress: 100,
        segmentCount: data.segmentCount || 0,
      }
      break

    case DocumentEventType.EMBEDDING_STARTED:
      newState = {
        ...newState,
        step: 'embedding',
        progress: 0,
        segmentCount: data.totalSegments || newState.segmentCount,
      }
      break

    case DocumentEventType.EMBEDDING_PROGRESS:
      newState = {
        ...newState,
        step: 'embedding',
        progress: data.progress || 0,
        currentSegment: data.currentSegment || 0,
      }
      break

    case DocumentEventType.EMBEDDING_COMPLETED:
      newState = { ...newState, step: 'embedding', progress: 100 }
      break

    case DocumentEventType.PROCESSING_COMPLETED:
      isComplete = true
      newState = {
        ...newState,
        status: 'completed',
        step: 'embedding',
        progress: 100,
        processingTimeMs: data.totalProcessingTimeMs || null,
        segmentCount: data.segmentCount || newState.segmentCount,
      }
      break

    case DocumentEventType.PROCESSING_FAILED:
      isFailed = true
      error = data.error || 'Unknown error'
      newState = {
        ...newState,
        status: 'failed',
        error: error ?? null,
      }
      break

    case 'connection_error':
      isFailed = true
      error = data.message || 'Connection error'
      newState = {
        ...newState,
        status: 'failed',
        error: error ?? null,
      }
      break
  }

  return { state: newState, isComplete, isFailed, error }
}

/**
 * Hook for managing multiple document processing SSE connections
 * Automatically tracks documents in PROCESSING state and provides aggregate status
 */
export function useDocumentProcessing(
  options: UseDocumentProcessingOptions
): UseDocumentProcessingReturn {
  const { documents, onDocumentComplete, onDocumentFailed, onAllComplete } = options

  // State for all processing documents - this is the single source of truth
  // Documents remain here even after completion for display purposes
  const [processingStates, setProcessingStates] = useState<Map<string, DocumentProcessingState>>(
    new Map()
  )

  // Ref to track which documents have active SSE connections (prevents duplicates)
  const connectedDocumentsRef = useRef<Set<string>>(new Set())

  // EventSource references for each document
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map())

  // Refs for callbacks to avoid stale closures
  const onDocumentCompleteRef = useRef(onDocumentComplete)
  const onDocumentFailedRef = useRef(onDocumentFailed)
  const onAllCompleteRef = useRef(onAllComplete)

  useEffect(() => {
    onDocumentCompleteRef.current = onDocumentComplete
    onDocumentFailedRef.current = onDocumentFailed
    onAllCompleteRef.current = onAllComplete
  }, [onDocumentComplete, onDocumentFailed, onAllComplete])

  /**
   * Create an SSE connection for a document
   */
  const createConnection = useCallback((documentId: string, filename: string) => {
    // Don't create duplicate connections
    if (connectedDocumentsRef.current.has(documentId)) {
      return
    }

    // Mark as connected before creating EventSource
    connectedDocumentsRef.current.add(documentId)

    const eventSource = new EventSource(`/api/documents/${documentId}/events`)
    eventSourcesRef.current.set(documentId, eventSource)

    // Initialize state
    setProcessingStates((prev) => {
      const newMap = new Map(prev)
      newMap.set(documentId, createInitialState(documentId, filename))
      return newMap
    })

    // Handle events
    const handleEvent = (eventType: string, data: any) => {
      setProcessingStates((prev) => {
        const currentState = prev.get(documentId)
        if (!currentState) return prev

        const { state, isComplete, isFailed, error } = processEvent(currentState, eventType, data)

        const newMap = new Map(prev)
        newMap.set(documentId, state)

        // Handle completion/failure - close connection but keep state for display
        if (isComplete) {
          setTimeout(() => {
            // Close the connection
            const es = eventSourcesRef.current.get(documentId)
            if (es) {
              es.close()
              eventSourcesRef.current.delete(documentId)
            }
            connectedDocumentsRef.current.delete(documentId)

            // Fire callback
            onDocumentCompleteRef.current?.(documentId, state)

            // Check if all documents are now complete
            setProcessingStates((currentStates) => {
              const hasActiveProcessing = Array.from(currentStates.values()).some(
                (s) => s.status !== 'completed' && s.status !== 'failed'
              )
              if (!hasActiveProcessing && currentStates.size > 0) {
                setTimeout(() => onAllCompleteRef.current?.(), 0)
              }
              return currentStates
            })
          }, 0)
        }

        if (isFailed && error) {
          setTimeout(() => {
            // Close the connection
            const es = eventSourcesRef.current.get(documentId)
            if (es) {
              es.close()
              eventSourcesRef.current.delete(documentId)
            }
            connectedDocumentsRef.current.delete(documentId)

            // Fire callback
            onDocumentFailedRef.current?.(documentId, error)
          }, 0)
        }

        return newMap
      })
    }

    // Listen for each event type
    for (const eventType of SSE_EVENTS) {
      if (eventType === 'error') continue // Skip native error event

      eventSource.addEventListener(eventType, (event: MessageEvent) => {
        try {
          if (!event.data || event.data === 'undefined') return
          const data = JSON.parse(event.data)
          handleEvent(eventType, data)
        } catch (err) {
          console.error(`Failed to parse ${eventType} event:`, err)
        }
      })
    }

    // Handle connection errors
    eventSource.onerror = () => {
      // EventSource handles reconnection automatically
      // Only update state if connection is permanently closed
      if (eventSource.readyState === EventSource.CLOSED) {
        handleEvent('connection_error', { message: 'Connection closed' })
      }
    }
  }, [])

  // Auto-track documents that are in PROCESSING state
  useEffect(() => {
    const processingDocs = documents.filter((doc) => doc.status === 'PROCESSING')

    // Find new documents to track - check both ref and state to prevent duplicates
    for (const doc of processingDocs) {
      const hasConnection = connectedDocumentsRef.current.has(doc.id)
      const hasState = processingStates.has(doc.id)

      // Only create connection if we don't already have one AND don't have state
      if (!hasConnection && !hasState) {
        createConnection(doc.id, doc.filename)
      }
    }
    // Note: We don't remove documents from processingStates here
    // They stay for display until user manually dismisses
  }, [documents, processingStates, createConnection])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [, eventSource] of eventSourcesRef.current) {
        eventSource.close()
      }
      eventSourcesRef.current.clear()
      connectedDocumentsRef.current.clear()
    }
  }, [])

  /**
   * Clear all processing states (for manual toast dismiss)
   */
  const clearProcessingStates = useCallback(() => {
    // Close any remaining connections
    for (const [, eventSource] of eventSourcesRef.current) {
      eventSource.close()
    }
    eventSourcesRef.current.clear()
    connectedDocumentsRef.current.clear()
    setProcessingStates(new Map())
  }, [])

  // Calculate aggregate metrics from processingStates
  const activeCount = useMemo(() => {
    let count = 0
    for (const [, state] of processingStates) {
      if (state.status !== 'completed' && state.status !== 'failed') {
        count++
      }
    }
    return count
  }, [processingStates])

  const isProcessing = activeCount > 0
  const hasProcessingHistory = processingStates.size > 0

  const overallProgress = useMemo(() => {
    if (processingStates.size === 0) return 0

    let totalProgress = 0
    let count = 0

    for (const [, state] of processingStates) {
      // Calculate step-weighted progress
      let stepProgress = 0
      if (state.status === 'completed') {
        stepProgress = 100
      } else if (state.status === 'failed') {
        stepProgress = 0
      } else if (state.step === 'extraction') {
        stepProgress = state.progress * 0.33
      } else if (state.step === 'chunking') {
        stepProgress = 33 + state.progress * 0.33
      } else if (state.step === 'embedding') {
        stepProgress = 66 + state.progress * 0.34
      }
      totalProgress += stepProgress
      count++
    }

    return count > 0 ? Math.round(totalProgress / count) : 0
  }, [processingStates])

  return {
    processingStates,
    activeCount,
    overallProgress,
    isProcessing,
    hasProcessingHistory,
    clearProcessingStates,
  }
}
