// apps/web/src/components/workflow/store/interaction-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { storeEventBus } from './event-bus'
import { useCanvasStore } from './canvas-store'

/**
 * Interaction modes for the workflow canvas
 */
export type InteractionMode = 'pointer' | 'pan'

interface ReactFlowSettings {
  panOnDrag: boolean | number[]
  panOnScroll: boolean
  selectionOnDrag: boolean
  nodesDraggable: boolean
  nodesConnectable: boolean
  elementsSelectable: boolean
}

interface InteractionStore {
  // State
  mode: InteractionMode
  previousMode: InteractionMode | null
  isTemporaryPan: boolean
  settings: ReactFlowSettings

  // Actions
  setMode: (mode: InteractionMode) => void
  togglePanMode: () => void
  startTemporaryPan: () => void
  endTemporaryPan: () => void
}

/**
 * Store for managing canvas interaction modes
 */
// Helper function to compute settings based on mode and read-only state
const computeSettings = (mode: InteractionMode, readOnly: boolean): ReactFlowSettings => {
  // If in read-only mode, override all settings
  if (readOnly) {
    return {
      panOnDrag: true,
      panOnScroll: false,
      selectionOnDrag: false,
      nodesDraggable: false,
      nodesConnectable: true,
      elementsSelectable: false,
    }
  }

  // Pan mode settings (default)
  if (mode === 'pan') {
    return {
      panOnDrag: true, // Enable panning with left and middle mouse buttons
      panOnScroll: false, // If false, scrolling will zoom
      selectionOnDrag: false, // No selection box in pan mode
      nodesDraggable: true, // all nodes are still draggable
      nodesConnectable: true,
      elementsSelectable: true, // Nodes and edges can still be selected
    }
  }

  // Pointer mode
  return {
    panOnDrag: false, // No panning with left mouse button (used for selection)
    panOnScroll: false, // If false, scrolling will zoom
    selectionOnDrag: true, // Must be true to see box selection
    nodesDraggable: true, // all nodes are still draggable
    nodesConnectable: true,
    elementsSelectable: true,
  }
}

export const useInteractionStore = create<InteractionStore>()(
  subscribeWithSelector((set, get) => {
    // Initial state
    const initialMode = 'pan' as InteractionMode
    const initialReadOnly = useCanvasStore.getState().readOnly

    // Subscribe to canvas store changes
    useCanvasStore.subscribe(
      (state) => state.readOnly,
      (readOnly) => {
        const mode = get().mode
        set({ settings: computeSettings(mode, readOnly) })
      }
    )

    return {
      mode: initialMode,
      previousMode: null,
      isTemporaryPan: false,
      settings: computeSettings(initialMode, initialReadOnly),

      setMode: (mode) => {
        const readOnly = useCanvasStore.getState().readOnly
        set({
          mode,
          isTemporaryPan: false,
          previousMode: null,
          settings: computeSettings(mode, readOnly),
        })
        console.log('Setting interaction mode to:', mode)
        // Emit event for other components
        storeEventBus.emit({ type: 'interaction:modeChanged', data: { mode } })
      },

      togglePanMode: () => {
        const currentMode = get().mode
        const newMode = currentMode === 'pan' ? 'pointer' : 'pan'
        get().setMode(newMode)
      },

      startTemporaryPan: () => {
        const currentMode = get().mode
        if (currentMode !== 'pan') {
          const readOnly = useCanvasStore.getState().readOnly
          set({
            mode: 'pan',
            previousMode: currentMode,
            isTemporaryPan: true,
            settings: computeSettings('pan', readOnly),
          })

          // Emit event for other components
          storeEventBus.emit({ type: 'interaction:modeChanged', data: { mode: 'pan' } })
        }
      },

      endTemporaryPan: () => {
        const { isTemporaryPan, previousMode } = get()
        if (isTemporaryPan && previousMode) {
          const readOnly = useCanvasStore.getState().readOnly
          set({
            mode: previousMode,
            previousMode: null,
            isTemporaryPan: false,
            settings: computeSettings(previousMode, readOnly),
          })

          // Emit event for other components
          storeEventBus.emit({ type: 'interaction:modeChanged', data: { mode: previousMode } })
        }
      },
    }
  })
)
