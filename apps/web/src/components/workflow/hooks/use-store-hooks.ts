// apps/web/src/components/workflow/hooks/use-store-hooks.ts

import { useMemo } from 'react'
import { shallow } from 'zustand/shallow'
import { useCanvasStore } from '../store/canvas-store'

/**
 * Essential store hooks for the new drag-aware architecture
 * Minimal set of hooks to replace use-workflow-store-optimized.ts
 */

// Canvas store hooks
export const useViewport = () => useCanvasStore((state) => state.viewport, shallow)

export const useCanvasSettings = () => {
  const snapToGrid = useCanvasStore((state) => state.snapToGrid)
  const gridSize = useCanvasStore((state) => state.gridSize)
  const showGrid = useCanvasStore((state) => state.showGrid)
  const showMinimap = useCanvasStore((state) => state.showMinimap)

  return useMemo(
    () => ({
      snapToGrid,
      gridSize,
      showGrid,
      showMinimap,
    }),
    [snapToGrid, gridSize, showGrid, showMinimap]
  )
}

export const useCanvasActions = () => {
  const setViewport = useCanvasStore((state) => state.setViewport)
  const fitView = useCanvasStore((state) => state.fitView)
  const zoomIn = useCanvasStore((state) => state.zoomIn)
  const zoomOut = useCanvasStore((state) => state.zoomOut)
  const resetView = useCanvasStore((state) => state.resetView)
  const toggleSnapToGrid = useCanvasStore((state) => state.toggleSnapToGrid)
  const toggleGrid = useCanvasStore((state) => state.toggleGrid)
  const toggleMinimap = useCanvasStore((state) => state.toggleMinimap)

  return useMemo(
    () => ({
      setViewport,
      fitView,
      zoomIn,
      zoomOut,
      resetView,
      toggleSnapToGrid,
      toggleGrid,
      toggleMinimap,
    }),
    [setViewport, fitView, zoomIn, zoomOut, resetView, toggleSnapToGrid, toggleGrid, toggleMinimap]
  )
}
