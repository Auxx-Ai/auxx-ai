// apps/web/src/components/mail/email-editor/ai-tools.tsx
'use client'

import type { Editor } from '@tiptap/react'
import { Button } from '@auxx/ui/components/button'
import {
  FoldVertical,
  Languages,
  SlidersHorizontal,
  Sparkles,
  SpellCheck2,
  UnfoldVertical,
} from 'lucide-react'
import EditorSelector from '~/components/editor/editor-selector'
import type { useAIToolsState } from './hooks/use-ai-tools-state'
import {
  AI_OPERATION,
  AI_TONE_TYPE_VALUES,
  AI_LANG_TYPE_VALUES,
  type AIOperation,
} from '~/types/ai-tools'

interface AIToolsProps {
  editor: Editor | null
  threadId?: string
  hasContent: boolean
  hasPreviousMessages: boolean
  state: ReturnType<typeof useAIToolsState>['state']
  onOperation: (operation: AIOperation, options?: { tone?: string; language?: string }) => void
}

/**
 * AI Tools component for email editor
 * Provides AI-powered operations like compose, tone adjustment, translation, etc.
 */
export function AITools({
  editor,
  threadId,
  hasContent,
  hasPreviousMessages,
  state,
  onOperation,
}: AIToolsProps) {
  // Compose button for empty editor
  if (!hasContent) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="text-comparison-500 hover:text-comparison-500 hover:bg-comparison-100 hover:border-comparison-200 transition-colors duration-300"
          disabled={!hasPreviousMessages || state.isProcessing}
          onClick={() => onOperation(AI_OPERATION.COMPOSE)}>
          <Sparkles className="text-comparison-500" />
          Compose
        </Button>
        {!hasPreviousMessages && (
          <span className="text-xs text-muted-foreground">
            No previous messages to base composition on
          </span>
        )}
      </div>
    )
  }

  // Full AI tools toolbar
  return (
    <div className="flex items-center gap-0.5">
      {/* Tone Selector */}
      <EditorSelector
        id="tone-selector"
        options={Object.entries(AI_TONE_TYPE_VALUES).map(([key, value]) => ({
          value,
          label: value,
        }))}
        value=""
        onChange={(tone) => onOperation(AI_OPERATION.TONE, { tone })}
        placeholder="Tone"
        placeholderIcon={<SlidersHorizontal className="size-3.5" />}
        disabled={state.isProcessing}
        className="min-w-[100px]"
      />

      {/* Fix Grammar Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOperation(AI_OPERATION.FIX_GRAMMAR)}
        disabled={state.isProcessing}>
        <SpellCheck2 />
        Fix grammar
      </Button>

      {/* Language Selector */}
      <EditorSelector
        id="language-selector"
        options={Object.entries(AI_LANG_TYPE_VALUES).map(([key, value]) => ({
          value,
          label: value,
        }))}
        value=""
        onChange={(language) => onOperation(AI_OPERATION.TRANSLATE, { language })}
        placeholder="Translate"
        placeholderIcon={<Languages className="size-3.5" />}
        disabled={state.isProcessing}
        className="min-w-[100px]"
      />

      {/* Expand Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOperation(AI_OPERATION.EXPAND)}
        disabled={state.isProcessing}>
        <UnfoldVertical />
        Expand
      </Button>

      {/* Shorten Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOperation(AI_OPERATION.SHORTEN)}
        disabled={state.isProcessing}>
        <FoldVertical />
        Shorten
      </Button>
    </div>
  )
}
