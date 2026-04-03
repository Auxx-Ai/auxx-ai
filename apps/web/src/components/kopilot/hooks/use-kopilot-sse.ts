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
  context?: {
    activeThreadId?: string
    activeContactId?: string
    filters?: Record<string, unknown>
  }
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
  const setError = useKopilotStore((s) => s.setError)

  // Stable ref for onRequestSent to avoid re-triggering effects
  const onRequestSentRef = useRef(onRequestSent)
  useEffect(() => {
    onRequestSentRef.current = onRequestSent
  }, [onRequestSent])

  // Track the current streaming message ID so llm-complete can commit it
  const streamingMessageIdRef = useRef<string | null>(null)

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
          break
        }
        case 'agent-started': {
          setCurrentAgent(data.agent)
          break
        }
        case 'llm-stream': {
          // Skip internal agents (e.g. supervisor routing classification)
          if (data.agent === 'supervisor') break
          appendStreamDelta(data.delta)
          break
        }
        case 'llm-complete': {
          // Skip internal agents (e.g. supervisor routing classification)
          if (data.agent === 'supervisor') break
          // Commit accumulated streaming content as a new assistant message
          const store = useKopilotStore.getState()
          const content = store.stream.streamingContent
          if (content) {
            const msgId = streamingMessageIdRef.current || generateId()
            addMessage({
              id: msgId,
              role: 'assistant',
              content,
              timestamp: Date.now(),
              parentId: getCurrentLeafId(),
            })
          }
          streamingMessageIdRef.current = null
          clearStream()
          break
        }
        case 'tool-started': {
          const toolMsgId = generateId()
          addActiveTool(data.tool, data.agent)
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
          // Find and update the matching tool message
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
          addMessage({
            id: generateId(),
            role: 'system',
            content: `Approval needed: ${data.tool}`,
            timestamp: Date.now(),
            parentId: getCurrentLeafId(),
            approvalRequired: true,
            approvalStatus: 'pending',
            tool: { name: data.tool, args: data.args ?? {}, status: 'running' },
          })
          setIsStreaming(false)
          break
        }
        case 'message': {
          // Intentionally ignored — llm-complete already commits assistant messages.
          // This event is a server-side summary that duplicates streamed content.
          break
        }
        case 'pipeline-error': {
          setError(data.error)
          setIsStreaming(false)
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
      setError,
      getCurrentLeafId,
    ]
  )

  const handleError = useCallback(
    (error: Error) => {
      setError(error.message)
      setIsStreaming(false)
    },
    [setError, setIsStreaming]
  )

  // When pendingRequest is set, build SSE config to trigger connection
  useEffect(() => {
    if (!pendingRequest) {
      setSSEConfig(null)
      return
    }

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
