// apps/web/src/components/kopilot/hooks/use-kopilot-sse.ts

import { generateId } from '@auxx/utils/generateId'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type SSEConfig, useSSE } from '~/hooks/use-sse'
import { useKopilotStore } from '../stores/kopilot-store'

export interface KopilotRequest {
  sessionId?: string
  message: string
  type?: 'message' | 'approval'
  page?: string
  context?: Record<string, unknown>
  /** Approval action — required when type is 'approval' */
  approvalAction?: 'approve' | 'reject'
  /** Input amendment for approval actions (e.g. { saveAsDraft: true }) */
  inputAmendment?: Record<string, unknown>
  /** Model override in "provider:model" format — omit to use system default */
  modelId?: string
}

interface UseKopilotSSEOptions {
  /** Request to send (triggers SSE connection when non-null) */
  pendingRequest: KopilotRequest | null
  /** Called after connection starts to clear the pending request */
  onRequestSent: () => void
}

export function useKopilotSSE({ pendingRequest, onRequestSent }: UseKopilotSSEOptions) {
  const [sseConfig, setSSEConfig] = useState<SSEConfig | null>(null)

  const setActiveSessionId = useKopilotStore((s) => s.setActiveSessionId)
  const setCurrentRoute = useKopilotStore((s) => s.setCurrentRoute)
  const setIsStreaming = useKopilotStore((s) => s.setIsStreaming)
  const setCurrentAgent = useKopilotStore((s) => s.setCurrentAgent)
  const appendStreamDelta = useKopilotStore((s) => s.appendStreamDelta)
  const clearStream = useKopilotStore((s) => s.clearStream)
  const addMessage = useKopilotStore((s) => s.addMessage)
  const updateMessage = useKopilotStore((s) => s.updateMessage)
  const addActiveTool = useKopilotStore((s) => s.addActiveTool)
  const removeActiveTool = useKopilotStore((s) => s.removeActiveTool)

  // Thinking step actions
  const beginThinkingGroup = useKopilotStore((s) => s.beginThinkingGroup)
  const appendThinkingText = useKopilotStore((s) => s.appendThinkingText)
  const commitThinkingText = useKopilotStore((s) => s.commitThinkingText)
  const addThinkingToolStep = useKopilotStore((s) => s.addThinkingToolStep)
  const completeThinkingToolStep = useKopilotStore((s) => s.completeThinkingToolStep)
  const failThinkingToolStep = useKopilotStore((s) => s.failThinkingToolStep)
  const finalizeThinkingGroup = useKopilotStore((s) => s.finalizeThinkingGroup)
  const attachThinkingGroupToMessage = useKopilotStore((s) => s.attachThinkingGroupToMessage)

  // Stable ref for onRequestSent to avoid re-triggering effects
  const onRequestSentRef = useRef(onRequestSent)
  useEffect(() => {
    onRequestSentRef.current = onRequestSent
  }, [onRequestSent])

  // Track the current streaming message ID so llm-complete can commit it
  const streamingMessageIdRef = useRef<string | null>(null)

  // Track whether the responder committed a message in this pipeline run.
  // When false, the `message` event acts as a fallback to commit the response.
  const responderCommittedRef = useRef(false)

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
          break
        }
        case 'pipeline-started': {
          setCurrentRoute(data.route)
          setIsStreaming(true)
          responderCommittedRef.current = false
          break
        }
        case 'agent-started': {
          setCurrentAgent(data.agent)
          if (data.agent === 'executor') {
            beginThinkingGroup()
          }
          if (data.agent === 'responder') {
            finalizeThinkingGroup()
          }
          break
        }
        case 'llm-stream': {
          if (data.agent === 'responder') {
            appendStreamDelta(data.delta)
          } else if (data.agent === 'executor') {
            appendThinkingText(data.delta)
          }
          break
        }
        case 'llm-reasoning-stream': {
          // Reasoning content from thinking-enabled models (Kimi, DeepSeek, Qwen)
          // flows into the same thinking buffer during executor phase.
          // Responder reasoning is internal — not shown in the response stream.
          if (data.agent === 'executor') {
            appendThinkingText(data.delta)
          }
          break
        }
        case 'llm-complete': {
          if (data.agent === 'executor') {
            commitThinkingText()
          } else if (data.agent === 'responder') {
            // Commit the assistant message using the authoritative content from the
            // server event, falling back to the accumulated streaming deltas.
            const store = useKopilotStore.getState()
            const content = data.content || store.stream.streamingContent
            const leafId = getCurrentLeafId()

            if (content) {
              const msgId = streamingMessageIdRef.current || generateId()
              addMessage({
                id: msgId,
                role: 'assistant',
                content,
                timestamp: Date.now(),
                parentId: leafId,
              })
              attachThinkingGroupToMessage(msgId)
              responderCommittedRef.current = true
            }
            streamingMessageIdRef.current = null
            clearStream()
          }
          break
        }
        case 'tool-started': {
          const toolMsgId = generateId()
          addActiveTool(data.tool, data.agent)
          addThinkingToolStep(data.tool, data.args ?? {})
          // Still store tool message for persistence
          addMessage({
            id: toolMsgId,
            role: 'tool',
            content: '',
            timestamp: Date.now(),
            parentId: getCurrentLeafId(),
            tool: { name: data.tool, args: data.args ?? {}, status: 'running' },
          })
          break
        }
        case 'tool-completed': {
          removeActiveTool(data.tool)
          completeThinkingToolStep(data.tool, data.result?.output)
          // Still update tool message for persistence
          const store = useKopilotStore.getState()
          const toolMsg = Object.values(store.messageMap)
            .reverse()
            .find((m) => m.tool?.name === data.tool && m.tool?.status === 'running')
          if (toolMsg) {
            updateMessage(toolMsg.id, {
              tool: {
                ...toolMsg.tool!,
                status: 'completed',
                result: data.result?.output,
              },
            })
          }
          break
        }
        case 'tool-error': {
          removeActiveTool(data.tool)
          failThinkingToolStep(data.tool, data.error)
          const store = useKopilotStore.getState()
          const errToolMsg = Object.values(store.messageMap)
            .reverse()
            .find((m) => m.tool?.name === data.tool && m.tool?.status === 'running')
          if (errToolMsg) {
            updateMessage(errToolMsg.id, {
              tool: { ...errToolMsg.tool!, status: 'error', result: data.error },
            })
          }
          break
        }
        case 'approval-required': {
          // Finalize the thinking group and clear it so the active tool steps
          // don't flash before the approval card renders.
          finalizeThinkingGroup()
          attachThinkingGroupToMessage('_approval_') // clears activeThinkingGroupId
          addMessage({
            id: generateId(),
            role: 'system',
            content: `Approval needed: ${data.tool}`,
            timestamp: Date.now(),
            parentId: getCurrentLeafId(),
            approval: {
              toolName: data.tool,
              toolCallId: data.toolCallId,
              args: data.args ?? {},
              status: 'pending',
            },
          })
          setIsStreaming(false)
          break
        }
        case 'tool-rejected': {
          // Tool was rejected — nothing to update, the approval card already shows 'rejected'
          break
        }
        case 'message': {
          // Fallback: if the responder never ran (e.g. executor hit max iterations
          // or pipeline errored), this event carries the final assistant content.
          if (!responderCommittedRef.current && data.content) {
            const msgId = generateId()
            finalizeThinkingGroup()
            addMessage({
              id: msgId,
              role: 'assistant',
              content: data.content,
              timestamp: Date.now(),
              parentId: getCurrentLeafId(),
            })
            attachThinkingGroupToMessage(msgId)
            responderCommittedRef.current = true
            clearStream()
          }
          break
        }
        case 'pipeline-error': {
          const leafId = getCurrentLeafId()
          const errorMsgId = generateId()
          addMessage({
            id: errorMsgId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            parentId: leafId,
            error: data.error,
          })
          attachThinkingGroupToMessage(errorMsgId)
          setIsStreaming(false)
          clearStream()
          break
        }
        case 'done': {
          setIsStreaming(false)
          clearStream()
          break
        }
      }
    },
    [
      setActiveSessionId,
      setCurrentRoute,
      setIsStreaming,
      setCurrentAgent,
      appendStreamDelta,
      clearStream,
      addMessage,
      updateMessage,
      addActiveTool,
      removeActiveTool,
      getCurrentLeafId,
      beginThinkingGroup,
      appendThinkingText,
      commitThinkingText,
      addThinkingToolStep,
      completeThinkingToolStep,
      failThinkingToolStep,
      finalizeThinkingGroup,
      attachThinkingGroupToMessage,
    ]
  )

  const handleError = useCallback(
    (error: Error) => {
      const leafId = getCurrentLeafId()
      const errorMsgId = generateId()
      addMessage({
        id: errorMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        parentId: leafId,
        error: error.message,
      })
      setIsStreaming(false)
      clearStream()
    },
    [addMessage, getCurrentLeafId, setIsStreaming, clearStream]
  )

  // When pendingRequest is set, build SSE config to trigger connection
  useEffect(() => {
    if (!pendingRequest) {
      setSSEConfig(null)
      return
    }

    // Show status bar immediately — don't wait for server's pipeline-started event
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
