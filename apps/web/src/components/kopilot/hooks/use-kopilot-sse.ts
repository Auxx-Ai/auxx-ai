// apps/web/src/components/kopilot/hooks/use-kopilot-sse.ts

import { generateId } from '@auxx/utils/generateId'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type SSEConfig, useSSE } from '~/hooks/use-sse'
import { api } from '~/trpc/react'
import { useKopilotStore } from '../stores/kopilot-store'
import { patchSessionTitleInListCache, upsertSessionInListCache } from './kopilot-session-cache'

export interface KopilotRequest {
  sessionId?: string
  message: string
  type?: 'message' | 'approval'
  page?: string
  context?: Record<string, unknown>
  /** Approval action — required when type is 'approval' */
  approvalAction?: 'approve' | 'reject'
  /** Input amendment for approval actions (e.g. { mode: 'draft' }) */
  inputAmendment?: Record<string, unknown>
  /** Model override in "provider:model" format — omit to use system default */
  modelId?: string
  /** Target a user-authored agent on session create; ignored on existing sessions. */
  agentId?: string | null
  /** Session-domain discriminator on session create. Defaults to 'kopilot' server-side. */
  sessionType?: 'kopilot' | 'builder'
  /**
   * Trigger discriminator. 'dm' means the request originated from the agent
   * Chat tab or the composer sender picker; the SSE route gates the agent's
   * `dm` AgentTrigger and layers DM trigger-instructions into the prompt.
   */
  triggerKind?: 'dm'
}

interface UseKopilotSSEOptions {
  /** Request to send (triggers SSE connection when non-null) */
  pendingRequest: KopilotRequest | null
  /** Called after connection starts to clear the pending request */
  onRequestSent: () => void
}

/**
 * Thin event-mirror handler. Each server event projects directly onto a
 * single store mutation — no derivation, no fallbacks, no rescue paths. The
 * persisted shape and the streamed shape match by construction.
 */
export function useKopilotSSE({ pendingRequest, onRequestSent }: UseKopilotSSEOptions) {
  const [sseConfig, setSSEConfig] = useState<SSEConfig | null>(null)

  const utils = api.useUtils()

  const setActiveSessionId = useKopilotStore((s) => s.setActiveSessionId)
  const setCurrentRoute = useKopilotStore((s) => s.setCurrentRoute)
  const setIsStreaming = useKopilotStore((s) => s.setIsStreaming)
  const setCurrentAgent = useKopilotStore((s) => s.setCurrentAgent)
  const clearStream = useKopilotStore((s) => s.clearStream)
  const addMessage = useKopilotStore((s) => s.addMessage)
  const updateMessage = useKopilotStore((s) => s.updateMessage)
  const addActiveTool = useKopilotStore((s) => s.addActiveTool)
  const removeActiveTool = useKopilotStore((s) => s.removeActiveTool)
  const setPendingChipPrompts = useKopilotStore((s) => s.setPendingChipPrompts)

  // Parts actions
  const appendTextDelta = useKopilotStore((s) => s.appendTextDelta)
  const appendThinkingDelta = useKopilotStore((s) => s.appendThinkingDelta)
  const addToolCallPart = useKopilotStore((s) => s.addToolCallPart)
  const updateToolCallPart = useKopilotStore((s) => s.updateToolCallPart)
  const finalizeMessage = useKopilotStore((s) => s.finalizeMessage)

  // Stable ref for onRequestSent to avoid re-triggering effects
  const onRequestSentRef = useRef(onRequestSent)
  useEffect(() => {
    onRequestSentRef.current = onRequestSent
  }, [onRequestSent])

  /** Get the ID of the last visible message (current leaf of the active branch) */
  const getCurrentLeafId = useCallback((): string | null => {
    const { messages } = useKopilotStore.getState()
    return messages.length > 0 ? messages[messages.length - 1]!.id : null
  }, [])

  const handleEvent = useCallback(
    (eventType: string, data: any) => {
      switch (eventType) {
        case 'session-created': {
          setActiveSessionId(data.sessionId)
          upsertSessionInListCache(utils, {
            sessionId: data.sessionId,
            title: data.title ?? '',
            sessionType: data.sessionType,
            createdAt: data.createdAt,
          })
          break
        }
        case 'session-title-updated': {
          patchSessionTitleInListCache(utils, {
            sessionId: data.sessionId,
            title: data.title,
          })
          break
        }
        case 'turn-started': {
          setCurrentRoute(data.route)
          setIsStreaming(true)
          break
        }
        case 'agent-started': {
          setCurrentAgent(data.agent)
          break
        }
        case 'assistant-message-started': {
          // Open a new assistant bubble; all subsequent text/thinking/tool_call
          // events target this messageId until `assistant-message-finished`.
          addMessage({
            id: data.messageId,
            role: 'assistant',
            parts: [],
            timestamp: Date.now(),
            parentId: getCurrentLeafId(),
            metadata: data.agent ? { agent: data.agent } : undefined,
          })
          break
        }
        case 'text-delta': {
          appendTextDelta(data.messageId, data.partIndex, data.delta)
          break
        }
        case 'thinking-delta': {
          appendThinkingDelta(data.messageId, data.partIndex, data.delta)
          break
        }
        case 'tool-call-started': {
          addActiveTool(data.name, data.agent)
          addToolCallPart(data.messageId, data.partIndex, {
            toolCallId: data.toolCallId,
            name: data.name,
            args: data.args ?? {},
            agent: data.agent,
          })
          break
        }
        case 'tool-call-status': {
          // Lifecycle transition without an output payload — awaiting-approval,
          // executing (running), rejected. The producer is authoritative.
          updateToolCallPart(data.messageId, data.partIndex, {
            status: data.status,
            ...(data.digest !== undefined ? { digest: data.digest } : {}),
          })
          // Mirror onto a matching approval system message if present.
          const store = useKopilotStore.getState()
          const approvalMsg = Object.values(store.messageMap).find(
            (m) => m.approval?.toolCallId === data.toolCallId
          )
          if (approvalMsg?.approval) {
            const nextApprovalStatus =
              data.status === 'rejected'
                ? 'rejected'
                : data.status === 'completed' || data.status === 'running'
                  ? 'approved'
                  : approvalMsg.approval.status
            updateMessage(approvalMsg.id, {
              approval: { ...approvalMsg.approval, status: nextApprovalStatus },
            })
          }
          break
        }
        case 'tool-call-completed': {
          removeActiveTool(data.name ?? '')
          updateToolCallPart(data.messageId, data.partIndex, {
            status: 'completed',
            output: data.output,
            ...(data.digest !== undefined ? { digest: data.digest } : {}),
            ...(data.captured ? { captured: true } : {}),
          })
          // Side-channel snapshots embedded in tool output:
          // - `_suggestReplies` → render chips above the composer
          // - `_railUpdate` → invalidate the affected agent's detail query so
          //   the rail re-renders.
          const output = (data.output ?? null) as {
            _suggestReplies?: { version?: string; prompts?: Array<{ id: string; label: string }> }
            _railUpdate?: { agentId?: string }
          } | null
          if (output?._suggestReplies?.prompts) {
            setPendingChipPrompts(output._suggestReplies.prompts)
          }
          if (output?._railUpdate?.agentId) {
            const agentId = output._railUpdate.agentId
            void utils.agent.getById.invalidate({ agentId })
            void utils.agent.list.invalidate()
          }
          // Also mark a matching approval system message as approved on
          // completion — the tool actually ran.
          const store = useKopilotStore.getState()
          const approvalMsg = Object.values(store.messageMap).find(
            (m) => m.approval?.toolCallId === data.toolCallId
          )
          if (approvalMsg?.approval && approvalMsg.approval.status === 'pending') {
            updateMessage(approvalMsg.id, {
              approval: { ...approvalMsg.approval, status: 'approved' },
            })
          }
          break
        }
        case 'tool-call-failed': {
          removeActiveTool(data.name ?? '')
          updateToolCallPart(data.messageId, data.partIndex, {
            status: 'error',
            error: data.error,
          })
          break
        }
        case 'approval-required': {
          // Flip the tool_call part to awaiting-approval and mirror the
          // server-persisted system approval message into the store using
          // the same id. Server is the source of truth — if the message
          // already exists (e.g. from hydration), skip the duplicate add.
          updateToolCallPart(data.messageId, data.partIndex, {
            status: 'awaiting-approval',
            ...(data.digest !== undefined ? { digest: data.digest } : {}),
          })
          const approvalMsgId = data.approvalMessageId ?? generateId()
          const store = useKopilotStore.getState()
          if (!store.messageMap[approvalMsgId]) {
            addMessage({
              id: approvalMsgId,
              role: 'system',
              content: `Approval needed: ${data.toolName}`,
              timestamp: Date.now(),
              parentId: data.messageId,
              approval: {
                toolName: data.toolName,
                toolCallId: data.toolCallId,
                args: data.args ?? {},
                status: 'pending',
              },
            })
          }
          setIsStreaming(false)
          break
        }
        case 'assistant-message-finished': {
          // Canonical commit — replace parts wholesale so streaming + refresh
          // render from the same data.
          finalizeMessage(data.messageId, {
            parts: data.parts,
            linkSnapshots: data.linkSnapshots,
            usage: data.usage,
            truncated: data.truncated,
          })
          break
        }
        case 'assistant-message-paused': {
          // Approval pause — the message stays open server-side and the same
          // `messageId` will resume appending parts after the user decides.
          // The frontend already flipped isStreaming off in `approval-required`;
          // nothing to do here beyond letting the event flow through (billing
          // collectors upstream drain `iterations` on this event).
          break
        }
        case 'assistant-message-resumed': {
          // Continuation of the previously-paused message. The bubble keyed by
          // `data.messageId` already exists — no addMessage. Re-engage the
          // streaming UI so smooth-stream kicks in on subsequent deltas.
          setIsStreaming(true)
          if (data.agent) setCurrentAgent(data.agent)
          break
        }
        case 'turn-completed': {
          setIsStreaming(false)
          clearStream()
          break
        }
        case 'turn-error': {
          if (data.messageId) {
            updateMessage(data.messageId, { error: data.error })
          } else {
            addMessage({
              id: generateId(),
              role: 'assistant',
              parts: [],
              timestamp: Date.now(),
              parentId: getCurrentLeafId(),
              error: data.error,
            })
          }
          setIsStreaming(false)
          clearStream()
          break
        }
        case 'done': {
          // Terminal sentinel — defensive cleanup if turn-completed didn't fire.
          setIsStreaming(false)
          clearStream()
          break
        }
      }
    },
    [
      utils,
      setActiveSessionId,
      setCurrentRoute,
      setIsStreaming,
      setCurrentAgent,
      clearStream,
      addMessage,
      updateMessage,
      addActiveTool,
      removeActiveTool,
      setPendingChipPrompts,
      getCurrentLeafId,
      appendTextDelta,
      appendThinkingDelta,
      addToolCallPart,
      updateToolCallPart,
      finalizeMessage,
    ]
  )

  const handleError = useCallback(
    (error: Error) => {
      // Attach error to the trailing assistant message if one is in flight;
      // otherwise drop an empty error bubble so the user sees something.
      const { messages } = useKopilotStore.getState()
      const tail = messages[messages.length - 1]
      if (tail && tail.role === 'assistant' && !tail.error) {
        updateMessage(tail.id, { error: error.message })
      } else {
        addMessage({
          id: generateId(),
          role: 'assistant',
          parts: [],
          timestamp: Date.now(),
          parentId: getCurrentLeafId(),
          error: error.message,
        })
      }
      setIsStreaming(false)
      clearStream()
    },
    [addMessage, updateMessage, getCurrentLeafId, setIsStreaming, clearStream]
  )

  // When pendingRequest is set, build SSE config to trigger connection.
  // `setIsStreaming` is a stable Zustand setter — exclude it from deps so the
  // effect only re-runs on `pendingRequest` change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable store setter
  useEffect(() => {
    if (!pendingRequest) {
      setSSEConfig(null)
      return
    }

    // Show status bar immediately — don't wait for server's turn-started event
    setIsStreaming(true)

    setSSEConfig({
      url: '/api/kopilot/stream',
      method: 'POST',
      body: pendingRequest,
    })

    // Clear the pending request so the parent knows we've started
    onRequestSentRef.current()
  }, [pendingRequest])

  const { connectionStatus, disconnect } = useSSE(sseConfig, handleEvent, handleError)

  return { connectionStatus, disconnect }
}
