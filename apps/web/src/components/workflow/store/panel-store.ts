// apps/web/src/components/workflow/store/panel-store.ts
'use client'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import { useDockStore } from '~/stores/dock-store'
import { storeEventBus } from './event-bus'
import { useSelectionStore } from './selection-store'
import type { PanelState } from './types'
import { useWorkflowStore } from './workflow-store'

/** Type for panel types in docked tabbed mode */
type DockPanelType = 'property' | 'run' | 'settings'

// import { useNodeStore } from './node-store'
interface PanelStore extends PanelState {
  // Panel actions
  openPanel: (panel: PanelState['activePanel'], data?: any) => void
  closePanel: () => void
  togglePanel: (panel: PanelState['activePanel']) => void
  togglePinned: () => void

  // Panel size
  setPanelWidth: (width: number) => void

  // Panel data
  setPanelData: (data: any) => void
  updatePanelData: (updates: any) => void

  // Sidebar panels
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void

  // Modal panels
  activeModal: string | null
  modalData: any
  openModal: (modal: string, data?: any) => void
  closeModal: () => void

  // Run panel
  runPanelOpen: boolean
  runPanelTab: 'input' | 'result' | 'detail' | 'tracing'
  openRunPanel: () => void
  closeRunPanel: () => void
  setRunPanelTab: (tab: 'input' | 'result' | 'detail' | 'tracing') => void

  // Settings panel
  settingsPanelOpen: boolean
  openSettingsPanel: () => void
  closeSettingsPanel: () => void
  getSettingsPanelWidth: () => number
  getSettingsPanelNested: () => boolean

  // History popover
  historyPopoverOpen: boolean
  setHistoryPopoverOpen: (open: boolean) => void
  toggleHistoryPopover: () => void

  // Variable editor dialog
  variableEditorOpen: boolean
  setVariableEditorOpen: (open: boolean) => void
  toggleVariableEditor: () => void

  // Help overlay
  helpOverlayOpen: boolean
  setHelpOverlayOpen: (open: boolean) => void
  toggleHelpOverlay: () => void

  // Base panel tab state
  basePanelActiveTab: 'settings' | 'input' | 'result'
  setBasePanelTab: (tab: 'settings' | 'input' | 'result') => void

  // Panel stacking
  panelStack: Array<DockPanelType>
  addToStack: (panel: DockPanelType) => void
  removeFromStack: (panel: DockPanelType) => void
  clearStack: () => void
  getPanelPosition: (panel: DockPanelType) => number
  getPropertyPanelWidth: () => number
  getRunPanelWidth: () => number
  getPropertyPanelNested: () => boolean
  getRunPanelNested: () => boolean

  // Active dock tab (for tabbed mode when multiple panels are open)
  activeDockTab: DockPanelType
  setActiveDockTab: (tab: DockPanelType) => void
}

export type { DockPanelType }

/**
 * Create the panel store for managing UI panels
 */
export const usePanelStore = create<PanelStore>()(
  subscribeWithSelector((set, get) => ({
    activePanel: null,
    panelData: null,
    isPanelOpen: false,
    isPinned: safeLocalStorage.get('workflow-panel-pinned') === 'true',
    // panelWidth: 320,
    panelWidth: safeLocalStorage.get('workflow-node-panel-width')
      ? Number.parseFloat(safeLocalStorage.get('workflow-node-panel-width')!)
      : 500,

    leftSidebarOpen: false,
    rightSidebarOpen: true,

    activeModal: null,
    modalData: null,

    runPanelOpen: false,
    runPanelTab: 'input',

    settingsPanelOpen: false,

    historyPopoverOpen: false,

    variableEditorOpen: false,

    helpOverlayOpen: false,

    basePanelActiveTab: 'settings',

    // Panel stacking
    panelStack: [],

    // Active dock tab
    activeDockTab: 'property',

    addToStack: (panel) => {
      set((state) => {
        const newStack = state.panelStack.filter((p) => p !== panel) // Remove if exists
        return {
          panelStack: [...newStack, panel], // Add to end
          activeDockTab: panel, // Auto-select the newly opened panel
        }
      })
    },

    removeFromStack: (panel) => {
      set((state) => ({ panelStack: state.panelStack.filter((p) => p !== panel) }))
    },

    clearStack: () => {
      set({ panelStack: [] })
    },

    getPanelPosition: (panel) => {
      const state = get()
      return state.panelStack.indexOf(panel)
    },

    getPropertyPanelWidth: () => {
      const state = get()
      const position = state.panelStack.indexOf('property')
      if (position === -1) return 0 // Panel closed
      return position === 0 ? state.panelWidth : state.panelWidth - 30
    },

    getRunPanelWidth: () => {
      const state = get()
      const position = state.panelStack.indexOf('run')
      if (position === -1) return 0 // Panel closed
      return position === 0 ? state.panelWidth : state.panelWidth - 30
    },

    getPropertyPanelNested: () => {
      const state = get()
      const position = state.panelStack.indexOf('property')
      return position > 0 // nested if not first
    },

    getRunPanelNested: () => {
      const state = get()
      const position = state.panelStack.indexOf('run')
      return position > 0 // nested if not first
    },

    getSettingsPanelWidth: () => {
      const state = get()
      const position = state.panelStack.indexOf('settings')
      if (position === -1) return 0 // Panel closed
      return position === 0 ? state.panelWidth : state.panelWidth - 30
    },

    getSettingsPanelNested: () => {
      const state = get()
      const position = state.panelStack.indexOf('settings')
      return position > 0 // nested if not first
    },

    openPanel: (panel, data) => {
      const actions = get()
      // Close settings panel when opening property panel - they are mutually exclusive
      if (panel === 'properties' && get().settingsPanelOpen) {
        actions.closeSettingsPanel()
      }
      set({ activePanel: panel, panelData: data, isPanelOpen: true })
      if (panel === 'properties') {
        actions.addToStack('property')
      }
    },

    closePanel: () => {
      const actions = get()
      const currentPanel = get().activePanel
      set({
        activePanel: null,
        panelData: null,
        isPanelOpen: false,
        basePanelActiveTab: 'settings',
      })
      if (currentPanel === 'properties') {
        actions.removeFromStack('property')
      }
    },

    togglePanel: (panel) => {
      const state = get()

      if (state.activePanel === panel && state.isPanelOpen) {
        get().closePanel()
      } else {
        get().openPanel(panel)
      }
    },

    togglePinned: () => {
      set((state) => {
        const newPinnedState = !state.isPinned
        safeLocalStorage.set('workflow-panel-pinned', String(newPinnedState))
        return { isPinned: newPinnedState }
      })
    },

    setPanelWidth: (width) => {
      localStorage.setItem('workflow-node-panel-width', `${width}`)
      const newWidth = Math.max(200, Math.min(600, width))
      set({ panelWidth: newWidth })

      // Re-center the selected node with the new panel width
      const selectedNodes = useSelectionStore.getState().getSelectedNodes()
      if (selectedNodes.length === 1) {
        // Check if docked - when docked, canvas is already shrunk so no offset needed
        const isDocked = useDockStore.getState().isDocked
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches
        const effectivelyDocked = isDocked && isDesktop

        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('workflow:centerOnNode', {
              detail: {
                nodeId: selectedNodes[0],
                offset: effectivelyDocked ? { x: 0, y: 0 } : { x: -newWidth / 2, y: 0 },
                animation: { duration: 200 },
              },
            })
          )
        }, 50)
      }
    },

    setPanelData: (data) => {
      set({ panelData: data })
    },

    updatePanelData: (updates) => {
      set((state) => ({
        panelData: state.panelData ? { ...state.panelData, ...updates } : updates,
      }))
    },

    toggleLeftSidebar: () => {
      set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen }))
    },

    toggleRightSidebar: () => {
      set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen }))
    },

    openModal: (modal, data) => {
      set({ activeModal: modal, modalData: data })
    },

    closeModal: () => {
      set({ activeModal: null, modalData: null })
    },

    openRunPanel: () => {
      const actions = get()
      set({ runPanelOpen: true })
      actions.addToStack('run')
    },

    closeRunPanel: () => {
      const actions = get()
      set({ runPanelOpen: false })
      actions.removeFromStack('run')
    },

    setRunPanelTab: (tab) => {
      set({ runPanelTab: tab })
    },

    setHistoryPopoverOpen: (open) => {
      set({ historyPopoverOpen: open })
    },

    toggleHistoryPopover: () => {
      set((state) => ({ historyPopoverOpen: !state.historyPopoverOpen }))
    },

    setVariableEditorOpen: (open) => {
      set({ variableEditorOpen: open })
    },

    toggleVariableEditor: () => {
      set((state) => ({ variableEditorOpen: !state.variableEditorOpen }))
    },

    setHelpOverlayOpen: (open) => {
      set({ helpOverlayOpen: open })
    },

    toggleHelpOverlay: () => {
      set((state) => ({ helpOverlayOpen: !state.helpOverlayOpen }))
    },

    openSettingsPanel: () => {
      const actions = get()
      // Close property panel - settings and property are mutually exclusive
      if (get().activePanel === 'properties') {
        actions.closePanel()
      }
      set({ settingsPanelOpen: true })
      actions.addToStack('settings')
    },

    closeSettingsPanel: () => {
      const actions = get()
      set({ settingsPanelOpen: false })
      actions.removeFromStack('settings')
    },

    setBasePanelTab: (tab) => {
      set({ basePanelActiveTab: tab })
    },

    setActiveDockTab: (tab: DockPanelType) => {
      set({ activeDockTab: tab })
    },
  }))
)

// Helper function to handle panel logic based on selection
const handleSelectionPanelLogic = (nodes: string[], edges: string[]) => {
  const store = usePanelStore.getState()

  // Open property panel for single node selection
  if (nodes.length === 1 && edges.length === 0) {
    // Import NodeStore to check node type
    // const { useNodeStore } = require('./node-store')
    // const nodeStore = useNodeStore.getState()
    // const node = nodeStore.getNode(nodes[0])

    // Skip opening panel for note nodes
    // if (node?.type === 'note') {
    //   // Close panel if it's open
    //   if (store.activePanel === 'properties') {
    //     store.closePanel()
    //   }
    //   // Just center the node without panel offset
    //   setTimeout(() => {
    //     window.dispatchEvent(
    //       new CustomEvent('workflow:centerOnNode', {
    //         detail: { nodeId: nodes[0], animation: { duration: 300 } },
    //       })
    //     )
    //   }, 100)
    //   return
    // }

    store.openPanel('properties', { nodeId: nodes[0] })

    // Center the node with offset to account for the property panel
    // Use the panel width from the store which is already synced with localStorage
    const panelWidth = store.panelWidth

    // Check if docked - when docked, canvas is already shrunk so no offset needed
    const isDocked = useDockStore.getState().isDocked
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches
    const effectivelyDocked = isDocked && isDesktop

    // Dispatch center event with offset (negative x to shift left)
    // We offset by half the panel width to center in the visible area
    // When docked, no offset is needed since canvas is already shrunk
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('workflow:centerOnNode', {
          detail: {
            nodeId: nodes[0],
            offset: effectivelyDocked ? { x: 0, y: 0 } : { x: -panelWidth / 2, y: 0 },
            animation: { duration: 300 },
          },
        })
      )
    }, 100) // Small delay to ensure panel is opening
  }
  // Open property panel for single edge selection
  else if (edges.length === 1 && nodes.length === 0) {
    store.openPanel('properties', { edgeId: edges[0] })
  }
  // Close panel for no selection, multi-selection, or any other case (unless pinned)
  else {
    if (store.activePanel === 'properties' && !store.isPinned) {
      store.closePanel()
    }
  }
}

// Listen for selection changes to update property panel
storeEventBus.on('selection:changed', ({ nodes, edges }) => {
  const workflowStore = useWorkflowStore.getState()

  // 🔥 PERFORMANCE FIX: Don't auto-open panels during drag operations
  // This prevents WorkflowEditorInner from re-rendering during drag
  if (workflowStore.isDragging) {
    return
  }

  handleSelectionPanelLogic(nodes, edges)
})

// Listen for drag end events to open panel after drag completes
storeEventBus.on('drag:ended', ({ nodeIds }) => {
  // Small delay to ensure ReactFlow selection state is settled
  setTimeout(() => {
    // For single node drag, open the panel for that node
    if (nodeIds && nodeIds.length === 1) {
      const store = usePanelStore.getState()

      // Import NodeStore to check node type
      // const nodeStore = useNodeStore.getState()
      // const node = nodeStore.getNode(nodeIds[0])

      // Skip opening panel for note nodes
      // if (node?.type === 'note') {
      //   return
      // }

      store.openPanel('properties', { nodeId: nodeIds[0] })
    }
  }, 50) // Small delay to ensure state is settled
})
