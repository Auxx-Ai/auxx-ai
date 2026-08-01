// apps/web/src/components/mail/composer-shared/use-composer-ai-tools.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import {
  AI_OPERATION,
  AI_TONE_TYPE,
  type AIOperation,
  type AIToneType,
  COMPOSE_ENTITY_TYPE,
  OUTPUT_FORMAT,
  type OutputFormat,
} from '~/types/ai-tools'
import { useAIToolsState } from '../email-editor/hooks'

interface UseComposerAIToolsOptions {
  editor: Editor | null
  /** Entity id for the compose request (thread id, or '' when unknown). */
  entityId: string
  /**
   * How applied AI output is written back. Email passes the contentApplier-
   * backed setter; chat passes `editor.commands.setContent` directly. `content`
   * is a Tiptap JSON object for EDITOR output, otherwise an HTML string.
   */
  applyContent: (content: string | object, format: OutputFormat) => void
  /** Sync React content state after an AI write — the editor's canonical JSON. */
  onContentChanged: (json: JSONContent) => void
  /** Optional analytics hooks — email wires posthog; chat omits. */
  analytics?: {
    onComposeStarted?: () => void
    onComposeCompleted?: (durationMs?: number) => void
    onComposeFailed?: (error: string) => void
    onToolUsed?: (op: string, tone?: string, language?: string) => void
  }
}

const AI_TONE_VALUES: readonly string[] = Object.values(AI_TONE_TYPE)

/**
 * Narrows a free-form selector value to one of the compose API's named tones.
 * The tone pickers render `AI_TONE_TYPE` but hand back a bare `string`.
 */
export function isAiToneType(value: string | undefined): value is AIToneType {
  return !!value && AI_TONE_VALUES.includes(value)
}

/**
 * Shared AI-tools wiring: the undo/redo history state, the compose mutation,
 * and the `handleAIOperation` entrypoint. Consumer-specific side effects
 * (analytics, how content is applied) are injected via options.
 */
export function useComposerAITools({
  editor,
  entityId,
  applyContent,
  onContentChanged,
  analytics,
}: UseComposerAIToolsOptions) {
  const aiTools = useAIToolsState(editor)
  const { state, pushToHistory, setProcessing, setCurrentOperation, setError, clearError } = aiTools
  const aiStartTimeRef = useRef<number>(0)

  const processAI = api.aiFeature.compose.useMutation({
    onSuccess: (response) => {
      if (!editor) return
      // Apply new content based on format. EDITOR returns Tiptap JSON; HTML is
      // applied as-is; plain text is wrapped in a paragraph.
      if (response.format === OUTPUT_FORMAT.EDITOR) {
        applyContent(JSON.parse(response.content), response.format)
      } else if (response.format === OUTPUT_FORMAT.HTML) {
        applyContent(response.content, response.format)
      } else {
        applyContent(`<p>${response.content}</p>`, response.format)
      }
      // Sync React state — setContent doesn't emit onUpdate by default. The
      // canonical content model is JSON; undo/redo history stays HTML (applied
      // via setContent, which parses either form).
      onContentChanged(editor.getJSON())
      pushToHistory(editor.getHTML(), state.currentOperation)
      setProcessing(false)
      setCurrentOperation(null)
      clearError()
      analytics?.onComposeCompleted?.(
        aiStartTimeRef.current ? Date.now() - aiStartTimeRef.current : undefined
      )
    },
    onError: (error) => {
      toastError({ title: 'AI operation failed', description: error.message })
      setError(error.message)
      setProcessing(false)
      setCurrentOperation(null)
      analytics?.onComposeFailed?.(error.message)
    },
  })

  const handleAIOperation = useCallback(
    async (
      operation: AIOperation,
      options?: { tone?: AIToneType; language?: string; instruction?: string }
    ) => {
      if (!editor || state.isProcessing) return
      const currentContent = editor.getHTML()
      // Don't process if content is empty — except for compose / custom, which
      // both can generate from scratch (custom uses the typed instruction).
      if (
        operation !== AI_OPERATION.COMPOSE &&
        operation !== AI_OPERATION.CUSTOM &&
        !currentContent.replace(/<[^>]*>/g, '').trim()
      ) {
        toastError({
          title: 'No content',
          description: 'Please add some content before using AI tools',
        })
        return
      }

      if (operation === AI_OPERATION.COMPOSE) {
        analytics?.onComposeStarted?.()
      } else {
        analytics?.onToolUsed?.(operation.toLowerCase(), options?.tone, options?.language)
      }

      // Save current state to history so the operation can be undone.
      pushToHistory(currentContent, `before-${operation}`)
      setProcessing(true)
      setCurrentOperation(operation)
      aiStartTimeRef.current = Date.now()
      await processAI.mutateAsync({
        operation,
        messageHtml: currentContent,
        entityType: COMPOSE_ENTITY_TYPE.THREAD,
        entityId,
        senderId: 'current-user', // filled by backend
        output: OUTPUT_FORMAT.HTML,
        ...options,
      })
    },
    [
      editor,
      state.isProcessing,
      entityId,
      processAI,
      setProcessing,
      setCurrentOperation,
      pushToHistory,
      analytics,
    ]
  )

  return { ...aiTools, handleAIOperation }
}
