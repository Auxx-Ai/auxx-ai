// apps/web/src/components/kopilot/stores/kopilot-store.ts

import { generateId } from '@auxx/utils/generateId'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { summarizeToolResult } from '../ui/blocks/summarize-tool-result'

/** A single step within a thinking group */
export interface ThinkingStep {
  id: string
  /** Executor's reasoning text before/during this step */
  thinking?: string
  /** Tool call info (absent for pure-thinking steps) */
  tool?: {
    name: string
    /** Human-readable one-liner */
    summary?: string
    args: Record<string, unknown>
    status: 'running' | 'completed' | 'error'
    /** Optional entity references for inline badges */
    entities?: Array<{ recordId: string }>
  }
}

/** A group of thinking steps for one pipeline run */
export interface ThinkingGroup {
  id: string
  steps: ThinkingStep[]
  status: 'running' | 'completed' | 'error'
  /** Accumulated executor text that hasn't been attached to a step yet */
  pendingThinking: string
  /** The assistant message ID this group is attached to (set when responder commits) */
  messageId?: string
}

export interface KopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: number
  /** Parent message ID — null for root messages */
  parentId: string | null
  /** Agent metadata — identifies which agent produced this message */
  metadata?: { agent?: string }
  /** Tool calls on assistant messages (used for tool call lookup + executor detection) */
  toolCalls?: Array<{ id: string; function: { name: string; arguments: unknown } }>
  /** Tool call metadata (for tool messages) */
  tool?: {
    name: string
    args: Record<string, unknown>
    result?: unknown
    status: 'running' | 'completed' | 'error'
  }
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

/** Page context pushed by the active page so KopilotDock knows what's on-screen */
export interface KopilotPageContext {
  page: string
  [key: string]: unknown
}

interface KopilotState {
  // Panel
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  panelWidth: number
  setPanelWidth: (width: number) => void

  // Page context — set by the active page, read by KopilotDock
  context: KopilotPageContext | null
  setContext: (context: KopilotPageContext | null) => void

  // Session — null means "new session" (not yet created on server)
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  startNewSession: () => void

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

  // Thinking steps
  activeThinkingGroupId: string | null
  thinkingGroups: Record<string, ThinkingGroup>
  beginThinkingGroup: () => void
  appendThinkingText: (delta: string) => void
  commitThinkingText: () => void
  addThinkingToolStep: (tool: string, args: Record<string, unknown>) => void
  completeThinkingToolStep: (tool: string, result: unknown) => void
  failThinkingToolStep: (tool: string, error: string) => void
  finalizeThinkingGroup: () => void
  attachThinkingGroupToMessage: (messageId: string) => void
  reconstructThinkingGroups: (messages: KopilotMessage[]) => void

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

/**
 * Detect executor assistant messages — these should be hidden from the visible
 * message list and only used for thinking step reconstruction.
 */
export function isExecutorAssistant(m: KopilotMessage): boolean {
  // Tagged messages (new sessions after this fix)
  if (m.role === 'assistant' && m.metadata?.agent === 'executor') return true
  // Untagged messages (old sessions) — assistant with toolCalls = executor
  if (m.role === 'assistant' && !m.metadata?.agent && m.toolCalls && m.toolCalls.length > 0)
    return true
  return false
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

      // Page context
      context: null,
      setContext: (context) => set({ context }),

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
          activeThinkingGroupId: null,
          thinkingGroups: {},
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

      // Thinking steps
      activeThinkingGroupId: null,
      thinkingGroups: {},

      beginThinkingGroup: () =>
        set((s) => {
          const id = generateId()
          const group: ThinkingGroup = {
            id,
            steps: [],
            status: 'running',
            pendingThinking: '',
          }
          return {
            activeThinkingGroupId: id,
            thinkingGroups: { ...s.thinkingGroups, [id]: group },
          }
        }),

      appendThinkingText: (delta) =>
        set((s) => {
          const gid = s.activeThinkingGroupId
          if (!gid) return s
          const group = s.thinkingGroups[gid]
          if (!group) return s
          return {
            thinkingGroups: {
              ...s.thinkingGroups,
              [gid]: { ...group, pendingThinking: group.pendingThinking + delta },
            },
          }
        }),

      commitThinkingText: () =>
        set((s) => {
          const gid = s.activeThinkingGroupId
          if (!gid) return s
          const group = s.thinkingGroups[gid]
          if (!group || !group.pendingThinking.trim()) return s
          const text = group.pendingThinking.trim()
          const steps = [...group.steps]
          const last = steps[steps.length - 1]
          // If the last step is a pure-thinking step (no tool), append to it
          if (last && !last.tool) {
            steps[steps.length - 1] = {
              ...last,
              thinking: (last.thinking ? `${last.thinking}\n\n` : '') + text,
            }
          } else {
            steps.push({ id: generateId(), thinking: text })
          }
          return {
            thinkingGroups: {
              ...s.thinkingGroups,
              [gid]: { ...group, steps, pendingThinking: '' },
            },
          }
        }),

      addThinkingToolStep: (tool, args) =>
        set((s) => {
          const gid = s.activeThinkingGroupId
          if (!gid) return s
          const group = s.thinkingGroups[gid]
          if (!group) return s
          // Commit any pending thinking text, then attach it to the tool step
          const pendingText = group.pendingThinking.trim()
          const step: ThinkingStep = {
            id: generateId(),
            thinking: pendingText || undefined,
            tool: { name: tool, args, status: 'running' },
          }
          return {
            thinkingGroups: {
              ...s.thinkingGroups,
              [gid]: {
                ...group,
                steps: [...group.steps, step],
                pendingThinking: '',
              },
            },
          }
        }),

      completeThinkingToolStep: (tool, result) =>
        set((s) => {
          const gid = s.activeThinkingGroupId
          if (!gid) return s
          const group = s.thinkingGroups[gid]
          if (!group) return s
          const steps = [...group.steps]
          // Find the last running step for this tool
          for (let i = steps.length - 1; i >= 0; i--) {
            const step = steps[i]!
            if (step.tool?.name === tool && step.tool.status === 'running') {
              const { summary, entities } = summarizeToolResult(tool, result)
              steps[i] = {
                ...step,
                tool: { ...step.tool, status: 'completed', summary, entities },
              }
              break
            }
          }
          return {
            thinkingGroups: { ...s.thinkingGroups, [gid]: { ...group, steps } },
          }
        }),

      failThinkingToolStep: (tool, error) =>
        set((s) => {
          const gid = s.activeThinkingGroupId
          if (!gid) return s
          const group = s.thinkingGroups[gid]
          if (!group) return s
          const steps = [...group.steps]
          for (let i = steps.length - 1; i >= 0; i--) {
            const step = steps[i]!
            if (step.tool?.name === tool && step.tool.status === 'running') {
              steps[i] = {
                ...step,
                tool: { ...step.tool, status: 'error', summary: error },
              }
              break
            }
          }
          return {
            thinkingGroups: { ...s.thinkingGroups, [gid]: { ...group, steps } },
          }
        }),

      finalizeThinkingGroup: () =>
        set((s) => {
          const gid = s.activeThinkingGroupId
          if (!gid) return s
          const group = s.thinkingGroups[gid]
          if (!group) return s
          const hasError = group.steps.some((step) => step.tool?.status === 'error')
          return {
            thinkingGroups: {
              ...s.thinkingGroups,
              [gid]: { ...group, status: hasError ? 'error' : 'completed' },
            },
          }
        }),

      attachThinkingGroupToMessage: (messageId) =>
        set((s) => {
          const gid = s.activeThinkingGroupId
          if (!gid) return s
          const group = s.thinkingGroups[gid]
          if (!group) return s
          return {
            activeThinkingGroupId: null,
            thinkingGroups: {
              ...s.thinkingGroups,
              [gid]: { ...group, messageId },
            },
          }
        }),

      reconstructThinkingGroups: (allMessages) =>
        set(() => {
          const groups: Record<string, ThinkingGroup> = {}
          let currentGroup: ThinkingGroup | null = null
          let pendingThinking = ''

          for (const msg of allMessages) {
            if (msg.role === 'user') {
              currentGroup = null
              pendingThinking = ''
              continue
            }

            // Executor assistant message — extract thinking text
            if (isExecutorAssistant(msg)) {
              if (!currentGroup) {
                currentGroup = {
                  id: generateId(),
                  steps: [],
                  status: 'completed',
                  pendingThinking: '',
                }
              }
              if (msg.content?.trim()) {
                pendingThinking = msg.content.trim()
              }
              continue
            }

            // Tool message — add as a step
            if (msg.role === 'tool' && msg.tool) {
              if (!currentGroup) {
                currentGroup = {
                  id: generateId(),
                  steps: [],
                  status: 'completed',
                  pendingThinking: '',
                }
              }
              const { summary, entities } = summarizeToolResult(msg.tool.name, msg.tool.result)
              currentGroup.steps.push({
                id: generateId(),
                thinking: pendingThinking || undefined,
                tool: {
                  name: msg.tool.name,
                  args: msg.tool.args,
                  status: msg.tool.status === 'error' ? 'error' : 'completed',
                  summary,
                  entities,
                },
              })
              pendingThinking = ''
              continue
            }

            // Responder assistant message — attach group and finalize
            if (msg.role === 'assistant' && !isExecutorAssistant(msg)) {
              if (currentGroup && currentGroup.steps.length > 0) {
                // Attach any trailing thinking text (from the final executor message
                // after all tool calls) to the last tool step
                if (pendingThinking) {
                  const lastStep = currentGroup.steps[currentGroup.steps.length - 1]!
                  currentGroup.steps[currentGroup.steps.length - 1] = {
                    ...lastStep,
                    thinking: lastStep.thinking
                      ? `${lastStep.thinking}\n\n${pendingThinking}`
                      : pendingThinking,
                  }
                }
                currentGroup.messageId = msg.id
                groups[currentGroup.id] = currentGroup
              }
              currentGroup = null
              pendingThinking = ''
            }
          }

          return { thinkingGroups: groups, activeThinkingGroupId: null }
        }),

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
          activeThinkingGroupId: null,
          thinkingGroups: {},
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
