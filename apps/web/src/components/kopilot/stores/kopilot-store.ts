// apps/web/src/components/kopilot/stores/kopilot-store.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ContextSlice } from '../context/types'
import type { SuggestionSlice } from '../suggestions/types'

/**
 * Mirror of `LinkSnapshot` from `@auxx/lib/ai/agent-framework/types`. Inlined
 * because that subpath pulls in server-only deps; this file is client-side
 * Zustand store. Keep in sync with the lib type.
 */
export type LinkSnapshot =
  | { recordId: string; entityDefinitionId: string; displayName: string; summary?: string }
  | {
      threadId: string
      subject: string | null
      lastMessageAt: string | null
      sender?: string
      isUnread?: boolean
    }
  | { taskId: string; title: string; deadline: string | null; completedAt: string | null }
  | { slug: string; title: string; description?: string; url?: string }

/**
 * Mirror of the lib's `ToolCallStatus`. Inlined for the same reason as
 * `LinkSnapshot` — this is client-side and the lib subpath drags in server
 * deps.
 */
export type ToolCallStatus = 'running' | 'awaiting-approval' | 'completed' | 'error' | 'rejected'

/**
 * Mirror of the lib's `ContentPart`. Discriminated union — every part on an
 * assistant message is one of these. Order is preserved; the renderer walks
 * `parts` left → right and groups runs of contiguous tool_call parts into a
 * single thinking pill.
 */
export type ContentPart =
  | { type: 'text'; text: string; agent?: string }
  | { type: 'thinking'; text: string; agent?: string }
  | {
      type: 'tool_call'
      toolCallId: string
      name: string
      args: Record<string, unknown>
      status: ToolCallStatus
      output?: unknown
      digest?: unknown
      error?: string
      agent?: string
      captured?: true
    }

export type ToolCallPart = Extract<ContentPart, { type: 'tool_call' }>

/**
 * Kopilot message — discriminated by role. Assistant messages carry `parts[]`
 * (the canonical content-block shape); user/system messages carry a single
 * `content` string. The renderer reads `parts` for assistant bubbles and
 * `content` for everything else.
 */
export interface KopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  /** User + system messages keep a single string. Assistant messages use `parts`. */
  content?: string
  /** Assistant content blocks — one entry per text run, thinking run, or tool call. */
  parts?: ContentPart[]
  timestamp: number
  /** Parent message ID — null for root messages */
  parentId: string | null
  /** Agent metadata — last agent that contributed to this turn. */
  metadata?: { agent?: string; modelId?: string }
  /** Approval state — present when this message represents a tool approval request */
  approval?: {
    toolName: string
    toolCallId: string
    args: Record<string, unknown>
    status: 'pending' | 'approved' | 'rejected'
  }
  /** User feedback on this message (hydrated from AiMessageFeedback table) */
  feedback?: {
    isPositive: boolean
  }
  /** Error that occurred while generating this message */
  error?: string
  /**
   * Per-message lookup table for inline `auxx://` link chips, keyed by the
   * full href. Set on assistant messages at finalize time.
   */
  linkSnapshots?: Record<string, LinkSnapshot>
}

export interface KopilotStreamState {
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
  const visited = new Set<string>()
  let currentId: string | undefined = activeBranch['root'] ?? roots[0]

  while (currentId) {
    if (visited.has(currentId)) break
    visited.add(currentId)

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
  panelWidth: number
  setPanelWidth: (width: number) => void

  /**
   * Page context — distributed mount-time registration. Each `<KopilotContext>`
   * component writes one slice keyed by its `useId()`. Consumers read the
   * merged view via `selectMergedContext` / `useKopilotSurfaceRefs`.
   */
  contextSlices: Record<string, ContextSlice>
  setContextSlice: (id: string, slice: ContextSlice) => void
  clearContextSlice: (id: string) => void

  /**
   * Page-suggestions — distributed mount-time registration. Each
   * `<KopilotSuggestion>` writes one slice keyed by its `useId()`. Consumers
   * read the merged, priority-sorted view via `useKopilotSuggestions`.
   */
  suggestionSlices: Record<string, SuggestionSlice>
  setSuggestionSlice: (id: string, slice: SuggestionSlice) => void
  clearSuggestionSlice: (id: string) => void

  /**
   * Per-turn chip dismissals. Keyed as `<kind>:<id>` (e.g. `thread:abc`).
   * Cleared after each submit so the chip reappears next turn.
   */
  dismissedChipKeys: Set<string>
  dismissChip: (key: string) => void
  clearDismissedChips: () => void

  /**
   * Suggested-reply chips emitted by the `suggest_replies` tool. Rendered
   * above the composer; cleared on the next user submit.
   */
  pendingChipPrompts: Array<{ id: string; label: string }>
  setPendingChipPrompts: (prompts: Array<{ id: string; label: string }>) => void
  clearPendingChipPrompts: () => void

  // Session — null means "new session" (not yet created on server)
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  startNewSession: () => void

  /**
   * Agent the active session is bound to (post-create), if any. Master Kopilot
   * sessions leave this null. Hydrated from the server when `loadSession`
   * runs; cleared on `startNewSession`. The composer's sender picker reads
   * this for the locked-chip render — once a session has an agentId, the
   * picker becomes non-interactive.
   */
  activeSessionAgentId: string | null
  setActiveSessionAgentId: (id: string | null) => void

  // Model override — null means "use system default"
  selectedModelId: string | null
  setSelectedModelId: (modelId: string | null) => void

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
  setMessageFeedback: (messageId: string, isPositive: boolean | null) => void

  /**
   * Append `delta` to the text part at `partIndex` of the assistant message.
   * If the part doesn't exist yet (first delta), create it. If a different
   * part type exists at that index, this is a no-op (the SSE producer is
   * responsible for keeping partIndex in lockstep with the part type).
   */
  appendTextDelta: (messageId: string, partIndex: number, delta: string) => void
  /** Same as `appendTextDelta` but for thinking parts. */
  appendThinkingDelta: (messageId: string, partIndex: number, delta: string) => void
  /**
   * Insert a tool_call part at `partIndex` on the assistant message. Called
   * once per tool call on the `tool-call-started` event; subsequent updates
   * flow through `updateToolCallPart`.
   */
  addToolCallPart: (
    messageId: string,
    partIndex: number,
    toolCall: { toolCallId: string; name: string; args: Record<string, unknown>; agent?: string }
  ) => void
  /** Patch the tool_call part at `partIndex` (status, output, digest, error, captured). */
  updateToolCallPart: (
    messageId: string,
    partIndex: number,
    patch: Partial<Omit<ToolCallPart, 'type' | 'toolCallId' | 'name'>>
  ) => void
  /**
   * Replace the assistant message's parts wholesale with the canonical final
   * state from `assistant-message-finished`. Also applies linkSnapshots,
   * usage, and truncated metadata. This is the streaming/refresh checksum:
   * after finalize the in-store shape matches what `getSession` returns on F5.
   */
  finalizeMessage: (
    messageId: string,
    final: {
      parts: ContentPart[]
      linkSnapshots?: Record<string, LinkSnapshot>
      usage?: unknown
      truncated?: boolean
    }
  ) => void

  // Streaming
  stream: KopilotStreamState
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

  // Lifecycle
  reset: () => void
}

const initialStreamState: KopilotStreamState = {
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
      panelWidth: 420,
      setPanelWidth: (panelWidth) => set({ panelWidth }),

      // Page context — distributed slices
      contextSlices: {},
      setContextSlice: (id, slice) =>
        set((s) => ({ contextSlices: { ...s.contextSlices, [id]: slice } })),
      clearContextSlice: (id) =>
        set((s) => {
          if (!(id in s.contextSlices)) return s
          const next = { ...s.contextSlices }
          delete next[id]
          return { contextSlices: next }
        }),

      // Page suggestions — distributed slices
      suggestionSlices: {},
      setSuggestionSlice: (id, slice) =>
        set((s) => ({ suggestionSlices: { ...s.suggestionSlices, [id]: slice } })),
      clearSuggestionSlice: (id) =>
        set((s) => {
          if (!(id in s.suggestionSlices)) return s
          const next = { ...s.suggestionSlices }
          delete next[id]
          return { suggestionSlices: next }
        }),

      // Per-turn chip dismissals
      dismissedChipKeys: new Set<string>(),
      dismissChip: (key) =>
        set((s) => {
          if (s.dismissedChipKeys.has(key)) return s
          const next = new Set(s.dismissedChipKeys)
          next.add(key)
          return { dismissedChipKeys: next }
        }),
      clearDismissedChips: () =>
        set((s) => (s.dismissedChipKeys.size === 0 ? s : { dismissedChipKeys: new Set() })),

      // Suggested-reply chips emitted by `suggest_replies`
      pendingChipPrompts: [],
      setPendingChipPrompts: (pendingChipPrompts) => set({ pendingChipPrompts }),
      clearPendingChipPrompts: () =>
        set((s) => (s.pendingChipPrompts.length === 0 ? s : { pendingChipPrompts: [] })),

      // Session
      activeSessionId: null,
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      activeSessionAgentId: null,
      setActiveSessionAgentId: (activeSessionAgentId) => set({ activeSessionAgentId }),
      startNewSession: () =>
        set({
          activeSessionId: null,
          activeSessionAgentId: null,
          ...emptyTreeState,
          stream: { ...initialStreamState },
          isStreaming: false,
          editingMessageId: null,
          pendingChipPrompts: [],
          dismissedChipKeys: new Set<string>(),
        }),

      // Model override
      selectedModelId: null,
      setSelectedModelId: (selectedModelId) => set({ selectedModelId }),

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

      setMessageFeedback: (messageId, isPositive) =>
        set((s) => {
          const existing = s.messageMap[messageId]
          if (!existing) return s
          const updated = {
            ...existing,
            feedback: isPositive != null ? { isPositive } : undefined,
          }
          const newMessageMap = { ...s.messageMap, [messageId]: updated }
          return {
            messageMap: newMessageMap,
            messages: computeVisibleMessages(newMessageMap, s.childrenMap, s.activeBranch),
          }
        }),

      appendTextDelta: (messageId, partIndex, delta) =>
        set((s) => {
          const existing = s.messageMap[messageId]
          if (!existing) return s
          const parts = [...(existing.parts ?? [])]
          const current = parts[partIndex]
          if (current && current.type === 'text') {
            parts[partIndex] = { ...current, text: current.text + delta }
          } else if (!current) {
            // Pad with empty text parts if needed (rare; partIndex should track length)
            while (parts.length < partIndex) parts.push({ type: 'text', text: '' })
            parts[partIndex] = { type: 'text', text: delta }
          } else {
            // Mismatch: producer pointed partIndex at a non-text part. Skip.
            return s
          }
          const updated = { ...existing, parts }
          const newMessageMap = { ...s.messageMap, [messageId]: updated }
          return {
            messageMap: newMessageMap,
            messages: computeVisibleMessages(newMessageMap, s.childrenMap, s.activeBranch),
          }
        }),

      appendThinkingDelta: (messageId, partIndex, delta) =>
        set((s) => {
          const existing = s.messageMap[messageId]
          if (!existing) return s
          const parts = [...(existing.parts ?? [])]
          const current = parts[partIndex]
          if (current && current.type === 'thinking') {
            parts[partIndex] = { ...current, text: current.text + delta }
          } else if (!current) {
            while (parts.length < partIndex) parts.push({ type: 'text', text: '' })
            parts[partIndex] = { type: 'thinking', text: delta }
          } else {
            return s
          }
          const updated = { ...existing, parts }
          const newMessageMap = { ...s.messageMap, [messageId]: updated }
          return {
            messageMap: newMessageMap,
            messages: computeVisibleMessages(newMessageMap, s.childrenMap, s.activeBranch),
          }
        }),

      addToolCallPart: (messageId, partIndex, toolCall) =>
        set((s) => {
          const existing = s.messageMap[messageId]
          if (!existing) return s
          const parts = [...(existing.parts ?? [])]
          while (parts.length < partIndex) parts.push({ type: 'text', text: '' })
          parts[partIndex] = {
            type: 'tool_call',
            toolCallId: toolCall.toolCallId,
            name: toolCall.name,
            args: toolCall.args,
            status: 'running',
            ...(toolCall.agent ? { agent: toolCall.agent } : {}),
          }
          const updated = { ...existing, parts }
          const newMessageMap = { ...s.messageMap, [messageId]: updated }
          return {
            messageMap: newMessageMap,
            messages: computeVisibleMessages(newMessageMap, s.childrenMap, s.activeBranch),
          }
        }),

      updateToolCallPart: (messageId, partIndex, patch) =>
        set((s) => {
          const existing = s.messageMap[messageId]
          if (!existing) return s
          const parts = [...(existing.parts ?? [])]
          const current = parts[partIndex]
          if (!current || current.type !== 'tool_call') return s
          parts[partIndex] = { ...current, ...patch }
          const updated = { ...existing, parts }
          const newMessageMap = { ...s.messageMap, [messageId]: updated }
          return {
            messageMap: newMessageMap,
            messages: computeVisibleMessages(newMessageMap, s.childrenMap, s.activeBranch),
          }
        }),

      finalizeMessage: (messageId, final) =>
        set((s) => {
          const existing = s.messageMap[messageId]
          if (!existing) return s
          const updated: KopilotMessage = {
            ...existing,
            parts: final.parts,
            ...(final.linkSnapshots ? { linkSnapshots: final.linkSnapshots } : {}),
          }
          const newMessageMap = { ...s.messageMap, [messageId]: updated }
          return {
            messageMap: newMessageMap,
            messages: computeVisibleMessages(newMessageMap, s.childrenMap, s.activeBranch),
          }
        }),

      // Streaming
      stream: { ...initialStreamState },
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

      // Lifecycle
      reset: () =>
        set({
          activeSessionId: null,
          activeSessionAgentId: null,
          ...emptyTreeState,
          stream: { ...initialStreamState },
          isStreaming: false,
          editingMessageId: null,
          pendingChipPrompts: [],
          dismissedChipKeys: new Set<string>(),
        }),
    }),
    {
      name: 'kopilot-preferences',
      partialize: (state) => ({
        panelOpen: state.panelOpen,
        activeSessionId: state.activeSessionId,
        panelWidth: state.panelWidth,
      }),
    }
  )
)
