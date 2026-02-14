// apps/web/src/components/workflow/hooks/use-node-dimensions.ts

import { useStoreApi, useUpdateNodeInternals } from '@xyflow/react'
import { produce } from 'immer'
import { useEffect, useRef } from 'react'

// Tolerance in pixels to prevent infinite update loops
const DIMENSION_TOLERANCE = 2

/**
 * Hook to monitor node dimension changes and update ReactFlow internals
 * This ensures ReactFlow has accurate node dimensions for selection bounds
 */
export const useNodeDimensions = (nodeId: string, dependencies: any[] = []) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const store = useStoreApi()

  const nodeRef = useRef<HTMLDivElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const lastDimensionsRef = useRef<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (!nodeRef.current) return

    // Create ResizeObserver to monitor dimension changes
    resizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === nodeRef.current) {
          const { width, height } = entry.contentRect
          // const newWidth = Math.ceil(width)
          const newHeight = Math.ceil(height)

          // Check if dimensions have changed significantly
          const lastDims = lastDimensionsRef.current
          if (
            lastDims &&
            // Math.abs(lastDims.width - newWidth) < DIMENSION_TOLERANCE &&
            Math.abs(lastDims.height - newHeight) < DIMENSION_TOLERANCE
          ) {
            return // Skip update if change is within tolerance
          }

          // Update last dimensions
          lastDimensionsRef.current = { width: 0, height: newHeight }

          const { nodes, setNodes } = store.getState()

          // Update the node's dimensions in ReactFlow state
          const newNodes = produce(nodes, (draft) => {
            const node = draft.find((n) => n.id === nodeId)
            if (node) {
              // node.width = newWidth
              node.height = newHeight
            }
          })

          setNodes(newNodes)
          // Update ReactFlow's internal node dimensions
          updateNodeInternals(nodeId)
        }
      }
    })

    // Start observing
    resizeObserverRef.current.observe(nodeRef.current)

    // Initial measurement
    const rect = nodeRef.current.getBoundingClientRect()
    // const newWidth = Math.ceil(rect.width)
    const newHeight = Math.ceil(rect.height)

    // Set initial dimensions
    lastDimensionsRef.current = { width: 0, height: newHeight }

    const { nodes, setNodes } = store.getState()

    const newNodes = produce(nodes, (draft) => {
      const node = draft.find((n) => n.id === nodeId)
      if (node) {
        // node.width = newWidth
        node.height = newHeight
      }
    })

    setNodes(newNodes)
    updateNodeInternals(nodeId)

    // Cleanup
    return () => {
      if (resizeObserverRef.current && nodeRef.current) {
        resizeObserverRef.current.unobserve(nodeRef.current)
        resizeObserverRef.current.disconnect()
      }
    }
  }, [nodeId, updateNodeInternals, store])

  // Also update when dependencies change
  useEffect(() => {
    if (nodeRef.current) {
      const rect = nodeRef.current.getBoundingClientRect()
      // const newWidth = Math.ceil(rect.width)
      const newHeight = Math.ceil(rect.height)

      // Check if dimensions have changed significantly
      const lastDims = lastDimensionsRef.current
      if (
        lastDims &&
        // Math.abs(lastDims.width - newWidth) < DIMENSION_TOLERANCE &&
        Math.abs(lastDims.height - newHeight) < DIMENSION_TOLERANCE
      ) {
        return // Skip update if change is within tolerance
      }

      // Update last dimensions
      lastDimensionsRef.current = { width: 0, height: newHeight }

      const { nodes, setNodes } = store.getState()

      const newNodes = produce(nodes, (draft) => {
        const node = draft.find((n) => n.id === nodeId)
        if (node) {
          // node.width = newWidth
          node.height = newHeight
        }
      })

      setNodes(newNodes)
      updateNodeInternals(nodeId)
    }
  }, [nodeId, updateNodeInternals, store, ...dependencies])

  return nodeRef
}
