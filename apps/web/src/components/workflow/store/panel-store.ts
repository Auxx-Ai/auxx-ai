// apps/web/src/components/workflow/store/panel-store.ts
'use client'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import { useDockStore } from '~/stores/dock-store'
import { storeEventBus } from './event-bus'
import { useWorkflowStore } from './workflow-store'

/**
 * One screen of the editor panel's navigation stack.
 *
 * The stack is `[base]` or `[base, overlay]` and never deeper — Test and Settings
 * are *peers*, so opening one while the other is up replaces it rather than
 * burying it. That keeps the back chevron unambiguous: it always returns to the
 * node. See `plans/workflow/panel-nav-stack.md` §3.
 */
export type PanelFrame =
  | { kind: 'node'; nodeId: string }
  | { kind: 'empty' }
  | { kind: 'run' }
  | { kind: 'settings' }
  | { kind: 'kopilot' }

/** Frames pushed *over* the base by a toolbar action. */
export type OverlayKind = 'run' | 'settings' | 'kopilot'

/** Stable NavStack key for a frame. Base and overlay kinds draw from disjoint
 *  keyspaces, so a key can never appear twice in one stack. */
export function frameKey(frame: PanelFrame): string {
  return frame.kind === 'node' ? `node:${frame.nodeId}` : frame.kind
}

const EMPTY_BASE: PanelFrame = { kind: 'empty' }

interface PanelStore {
  /** `[]` = drawer closed. `[base]` or `[base, overlay]` otherwise. */
  frames: PanelFrame[]

  /** Replace the base frame. Pops any overlay — clicking a node means "show me
   *  that node", and its run output already lives on the node's Result tab. */
  setBase: (frame: PanelFrame) => void
  /** Canvas deselect. Keeps the base when pinned. Drops the drawer entirely when
   *  no overlay is up, since a bare "Select a node" panel is just noise. */
  clearBase: () => void
  /** Push (or replace) the overlay above whatever base is current. */
  openOverlay: (kind: OverlayKind) => void
  /** Drop the overlay, revealing the base. */
  popOverlay: () => void
  /** Close the whole drawer. */
  closeDrawer: () => void
  /** Close `kind` if it is the current overlay; no-op otherwise. */
  closeOverlay: (kind: OverlayKind) => void

  // Panel size (overlay mode; docked width lives in `useDockStore`)
  panelWidth: number
  setPanelWidth: (width: number) => void

  isPinned: boolean
  togglePinned: () => void

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

  // Run panel tab
  runPanelTab: 'input' | 'result' | 'detail' | 'tracing'
  setRunPanelTab: (tab: 'input' | 'result' | 'detail' | 'tracing') => void

  /**
   * Which Kopilot thread the builder frame targets, keyed by workflow.
   *
   * It lives here rather than in the frame because the frame is an OVERLAY:
   * selecting a node pops it and `NavStackPanels` unmounts it, which happens
   * constantly while building. Component state would lose a just-created
   * thread — the frame would remount with `initialSessionId={null}` (the
   * `limit: 1` lookup still inside its staleTime), and `KopilotChat`'s mount
   * effect would call `startNewSession()` on top of the live conversation.
   *
   * `sessionId: null` means "deliberately fresh". `null` overall means
   * unresolved — the frame falls back to the newest thread for the workflow.
   * The `workflowAppId` is part of the value because this store is a module
   * singleton: navigating workflow A → B must not inherit A's thread.
   */
  kopilotSession: { workflowAppId: string; sessionId: string | null } | null
  setKopilotSession: (value: { workflowAppId: string; sessionId: string | null }) => void
  /** Keys the KopilotChat instance so "Start new chat" forces a remount. */
  kopilotChatEpoch: number
  startNewKopilotChat: (workflowAppId: string) => void

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
}

// ── Selectors ────────────────────────────────────────────────────────────────

/** The frame the drawer is currently showing. */
export const selectTopFrame = (s: PanelStore): PanelFrame | undefined =>
  s.frames[s.frames.length - 1]

/** The frame underneath the overlay, if any. */
export const selectBaseFrame = (s: PanelStore): PanelFrame | undefined => s.frames[0]

/** True when `kind` is the frame on top. */
export const selectIsOverlayOpen =
  (kind: OverlayKind) =>
  (s: PanelStore): boolean =>
    selectTopFrame(s)?.kind === kind

/**
 * Whether the header should offer a back chevron. Depth alone isn't enough: an
 * overlay opened with nothing selected sits on an `empty` base, and "back to
 * nothing" is not a destination — those frames get a close button only.
 */
export const selectCanGoBack = (s: PanelStore): boolean =>
  s.frames.length > 1 && s.frames[0]?.kind !== 'empty'

/**
 * Create the panel store for managing UI panels
 */
export const usePanelStore = create<PanelStore>()(
  subscribeWithSelector((set, get) => ({
    frames: [],

    isPinned: safeLocalStorage.get('workflow-panel-pinned') === 'true',
    panelWidth: safeLocalStorage.get('workflow-node-panel-width')
      ? Number.parseFloat(safeLocalStorage.get('workflow-node-panel-width')!)
      : 500,

    leftSidebarOpen: false,
    rightSidebarOpen: true,

    activeModal: null,
    modalData: null,

    runPanelTab: 'input',

    kopilotSession: null,
    kopilotChatEpoch: 0,

    historyPopoverOpen: false,

    variableEditorOpen: false,

    helpOverlayOpen: false,

    basePanelActiveTab: 'settings',

    setBase: (frame) => {
      set({ frames: [frame] })
    },

    clearBase: () => {
      const { frames, isPinned } = get()
      if (frames.length === 0) return
      if (isPinned) return
      // An overlay is up: keep it, but drop the record beneath it.
      set({ frames: frames.length > 1 ? [EMPTY_BASE, frames[1]!] : [] })
    },

    openOverlay: (kind) => {
      const { frames } = get()
      set({ frames: [frames[0] ?? EMPTY_BASE, { kind }] })
    },

    popOverlay: () => {
      const { frames } = get()
      if (frames.length < 2) return
      const base = frames[0]!
      set({ frames: base.kind === 'empty' ? [] : [base] })
    },

    closeOverlay: (kind) => {
      if (selectTopFrame(get())?.kind !== kind) return
      get().popOverlay()
    },

    closeDrawer: () => {
      set({ frames: [], basePanelActiveTab: 'settings' })
    },

    togglePinned: () => {
      set((state) => {
        const newPinnedState = !state.isPinned
        safeLocalStorage.set('workflow-panel-pinned', String(newPinnedState))
        return { isPinned: newPinnedState }
      })
    },

    setPanelWidth: (width) => {
      safeLocalStorage.set('workflow-node-panel-width', `${width}`)
      const newWidth = Math.max(200, Math.min(600, width))
      set({ panelWidth: newWidth })

      // Re-center the node the drawer is showing, sourced from the BASE FRAME —
      // not `selection-store`. That store is written by exactly one path
      // (`use-node-interactions`'s add-node-from-connection) and never by a
      // canvas click, box-select or deselect, so its answer here was whatever
      // node was last added that way, or nothing at all. The base frame is the
      // panel's subject by definition, which is precisely what "re-center the
      // panel's node" means.
      const baseFrame = selectBaseFrame(get())
      if (baseFrame?.kind === 'node') {
        // Check if docked - when docked, canvas is already shrunk so no offset needed
        const isDocked = useDockStore.getState().isDocked
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches
        const effectivelyDocked = isDocked && isDesktop

        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('workflow:centerOnNode', {
              detail: {
                nodeId: baseFrame.nodeId,
                offset: effectivelyDocked ? { x: 0, y: 0 } : { x: -newWidth / 2, y: 0 },
                animation: { duration: 200 },
              },
            })
          )
        }, 50)
      }
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

    setRunPanelTab: (tab) => {
      set({ runPanelTab: tab })
    },

    setKopilotSession: (value) => {
      set({ kopilotSession: value })
    },

    startNewKopilotChat: (workflowAppId) => {
      set((state) => ({
        kopilotSession: { workflowAppId, sessionId: null },
        kopilotChatEpoch: state.kopilotChatEpoch + 1,
      }))
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

    setBasePanelTab: (tab) => {
      set({ basePanelActiveTab: tab })
    },
  }))
)

/** Center the canvas on a node, offsetting for the overlay panel when undocked. */
const centerOnNode = (nodeId: string, duration: number) => {
  const panelWidth = usePanelStore.getState().panelWidth
  const isDocked = useDockStore.getState().isDocked
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches
  // When docked the canvas is already shrunk, so no offset is needed.
  const effectivelyDocked = isDocked && isDesktop

  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('workflow:centerOnNode', {
        detail: {
          nodeId,
          offset: effectivelyDocked ? { x: 0, y: 0 } : { x: -panelWidth / 2, y: 0 },
          animation: { duration },
        },
      })
    )
  }, 100)
}

// Helper function to handle panel logic based on selection
const handleSelectionPanelLogic = (nodes: string[], edges: string[]) => {
  const store = usePanelStore.getState()

  // Single node selection — this becomes the base frame, replacing any overlay.
  if (nodes.length === 1 && edges.length === 0) {
    store.setBase({ kind: 'node', nodeId: nodes[0]! })
    centerOnNode(nodes[0]!, 300)
  }
  // Anything else — no selection, an edge, or a multi-selection. Edges have no
  // panel of their own (the node panel is resolved from the selected *node*), so
  // they clear the base rather than opening an empty frame.
  else {
    store.clearBase()
  }
}

// Listen for selection changes to update the base frame
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
    // For single node drag, show the panel for that node
    if (nodeIds && nodeIds.length === 1) {
      usePanelStore.getState().setBase({ kind: 'node', nodeId: nodeIds[0]! })
    }
  }, 50) // Small delay to ensure state is settled
})
