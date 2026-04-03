// apps/web/src/components/kopilot/stores/kopilot-store.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface KopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: number
  /** Parent message ID — null for root messages */
  parentId: string | null
  /** Tool call metadata (for tool messages) */
  tool?: {
    name: string
    args: Record<string, unknown>
    result?: unknown
    status: 'running' | 'completed' | 'error'
  }
  /** Whether this message requires approval */
  approvalRequired?: boolean
  /** Approval state */
  approvalStatus?: 'pending' | 'approved' | 'rejected'
}

export interface KopilotStreamState {
  /** Currently streaming text (accumulated deltas) */
  streamingContent: string
  /** Which agent is currently active */
  currentAgent: string | null
  /** Current route being executed */
  currentRoute: string | null
  /** Tools currently executing */
  activeTools: Array<{ tool: string; agent: string }>
}

/** Compute the visible message path by walking the tree from root to leaf */
function computeVisibleMessages(
  messageMap: Record<string, KopilotMessage>,
  childrenMap: Record<string, string[]>,
  activeBranch: Record<string, string>
): KopilotMessage[] {
  const roots = childrenMap['root']
  if (!roots || roots.length === 0) return []

  const path: KopilotMessage[] = []
  let currentId: string | undefined = activeBranch['root'] ?? roots[0]

  while (currentId) {
    const msg = messageMap[currentId]
    if (!msg) break

    path.push(msg)

    const children = childrenMap[currentId]
    if (!children || children.length === 0) break

    currentId = activeBranch[currentId] ?? children[0]
  }

  return path
}

/** Rebuild tree structures from a flat message array */
function rebuildTree(messages: KopilotMessage[]): {
  messageMap: Record<string, KopilotMessage>
  childrenMap: Record<string, string[]>
  activeBranch: Record<string, string>
} {
  const messageMap: Record<string, KopilotMessage> = {}
  const childrenMap: Record<string, string[]> = {}
  const activeBranch: Record<string, string> = {}

  for (const msg of messages) {
    messageMap[msg.id] = msg
    const parentKey = msg.parentId ?? 'root'
    if (!childrenMap[parentKey]) {
      childrenMap[parentKey] = []
    }
    childrenMap[parentKey].push(msg.id)
  }

  // Default activeBranch to last child at each fork (most recent)
  for (const [parentKey, children] of Object.entries(childrenMap)) {
    activeBranch[parentKey] = children[children.length - 1]!
  }

  return { messageMap, childrenMap, activeBranch }
}

interface KopilotState {
  // Panel
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void

  // Session — null means "new session" (not yet created on server)
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  startNewSession: () => void

  // Tree model
  messageMap: Record<string, KopilotMessage>
  childrenMap: Record<string, string[]>
  activeBranch: Record<string, string>

  // Computed visible messages (backward-compat)
  messages: KopilotMessage[]

  // Message actions
  addMessage: (message: KopilotMessage) => void
  setMessages: (messages: KopilotMessage[]) => void
  updateMessage: (id: string, updates: Partial<KopilotMessage>) => void
  setActiveBranch: (parentId: string, childId: string) => void

  // Streaming
  stream: KopilotStreamState
  setStreamingContent: (content: string) => void
  appendStreamDelta: (delta: string) => void
  setCurrentAgent: (agent: string | null) => void
  setCurrentRoute: (route: string | null) => void
  addActiveTool: (tool: string, agent: string) => void
  removeActiveTool: (tool: string) => void
  clearStream: () => void

  // Edit
  editingMessageId: string | null
  setEditingMessage: (messageId: string | null) => void

  // Status
  isStreaming: boolean
  setIsStreaming: (streaming: boolean) => void
  error: string | null
  setError: (error: string | null) => void

  // Lifecycle
  reset: () => void
}

const initialStreamState: KopilotStreamState = {
  streamingContent: '',
  currentAgent: null,
  currentRoute: null,
  activeTools: [],
}

const emptyTreeState = {
  messageMap: {} as Record<string, KopilotMessage>,
  childrenMap: {} as Record<string, string[]>,
  activeBranch: {} as Record<string, string>,
  messages: [] as KopilotMessage[],
}

export const useKopilotStore = create<KopilotState>()(
  persist(
    (set) => ({
      // Panel
      panelOpen: false,
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

      // Session
      activeSessionId: null,
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      startNewSession: () =>
        set({
          activeSessionId: null,
          ...emptyTreeState,
          stream: { ...initialStreamState },
          isStreaming: false,
          error: null,
          editingMessageId: null,
        }),

      // Tree model
      ...emptyTreeState,

      // Message actions
      addMessage: (message) =>
        set((s) => {
          const parentKey = message.parentId ?? 'root'
          const children = s.childrenMap[parentKey] ?? []
          const newMessageMap = { ...s.messageMap, [message.id]: message }
          const newChildrenMap = { ...s.childrenMap, [parentKey]: [...children, message.id] }
          const newActiveBranch = { ...s.activeBranch, [parentKey]: message.id }
          return {
            messageMap: newMessageMap,
            childrenMap: newChildrenMap,
            activeBranch: newActiveBranch,
            messages: computeVisibleMessages(newMessageMap, newChildrenMap, newActiveBranch),
          }
        }),

      setMessages: (messages) =>
        set(() => {
          const { messageMap, childrenMap, activeBranch } = rebuildTree(messages)
          return {
            messageMap,
            childrenMap,
            activeBranch,
            messages: computeVisibleMessages(messageMap, childrenMap, activeBranch),
          }
        }),

      updateMessage: (id, updates) =>
        set((s) => {
          const existing = s.messageMap[id]
          if (!existing) return s
          const updated = { ...existing, ...updates }
          const newMessageMap = { ...s.messageMap, [id]: updated }
          return {
            messageMap: newMessageMap,
            messages: computeVisibleMessages(newMessageMap, s.childrenMap, s.activeBranch),
          }
        }),

      setActiveBranch: (parentId, childId) =>
        set((s) => {
          const newActiveBranch = { ...s.activeBranch, [parentId]: childId }
          return {
            activeBranch: newActiveBranch,
            messages: computeVisibleMessages(s.messageMap, s.childrenMap, newActiveBranch),
          }
        }),

      // Streaming
      stream: { ...initialStreamState },
      setStreamingContent: (streamingContent) =>
        set((s) => ({ stream: { ...s.stream, streamingContent } })),
      appendStreamDelta: (delta) =>
        set((s) => ({
          stream: { ...s.stream, streamingContent: s.stream.streamingContent + delta },
        })),
      setCurrentAgent: (currentAgent) => set((s) => ({ stream: { ...s.stream, currentAgent } })),
      setCurrentRoute: (currentRoute) => set((s) => ({ stream: { ...s.stream, currentRoute } })),
      addActiveTool: (tool, agent) =>
        set((s) => ({
          stream: { ...s.stream, activeTools: [...s.stream.activeTools, { tool, agent }] },
        })),
      removeActiveTool: (tool) =>
        set((s) => ({
          stream: {
            ...s.stream,
            activeTools: s.stream.activeTools.filter((t) => t.tool !== tool),
          },
        })),
      clearStream: () => set({ stream: { ...initialStreamState } }),

      // Edit
      editingMessageId: null,
      setEditingMessage: (editingMessageId) => set({ editingMessageId }),

      // Status
      isStreaming: false,
      setIsStreaming: (isStreaming) => set({ isStreaming }),
      error: null,
      setError: (error) => set({ error }),

      // Lifecycle
      reset: () =>
        set({
          activeSessionId: null,
          ...emptyTreeState,
          stream: { ...initialStreamState },
          isStreaming: false,
          error: null,
          editingMessageId: null,
        }),
    }),
    {
      name: 'kopilot-preferences',
      partialize: (state) => ({
        panelOpen: state.panelOpen,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
)
