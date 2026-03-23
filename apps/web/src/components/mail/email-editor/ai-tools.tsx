// apps/web/src/components/mail/email-editor/ai-tools.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import type { Editor } from '@tiptap/react'
import {
  FoldVertical,
  Languages,
  SlidersHorizontal,
  Sparkles,
  SpellCheck2,
  UnfoldVertical,
} from 'lucide-react'
import EditorSelector from '~/components/editor/editor-selector'
import {
  AI_LANG_TYPE_VALUES,
  AI_OPERATION,
  AI_TONE_TYPE_VALUES,
  type AIOperation,
} from '~/types/ai-tools'
import type { useAIToolsState } from './hooks/use-ai-tools-state'

interface AIToolsProps {
  editor: Editor | null
  threadId?: string
  hasContent: boolean
  hasPreviousMessages: boolean
  state: ReturnType<typeof useAIToolsState>['state']
  onOperation: (operation: AIOperation, options?: { tone?: string; language?: string }) => void
  /** className forwarded to picker content elements (e.g. for z-index override) */
  popoverClassName?: string
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
  popoverClassName,
}: AIToolsProps) {
  // Compose button for empty editor
  if (!hasContent) {
    return (
      <div className='flex items-center gap-1'>
        <Button
          variant='outline'
          size='sm'
          className='text-comparison-500 hover:text-comparison-500 hover:bg-comparison-100 hover:border-comparison-200 transition-colors duration-300'
          disabled={!hasPreviousMessages || state.isProcessing}
          onClick={() => onOperation(AI_OPERATION.COMPOSE)}>
          <Sparkles className='text-comparison-500' />
          Compose
        </Button>
        {!hasPreviousMessages && (
          <span className='text-xs text-muted-foreground'>
            No previous messages to base composition on
          </span>
        )}
      </div>
    )
  }

  // Full AI tools toolbar
  return (
    <div className='flex items-center gap-0.5'>
      {/* Tone Selector */}
      <EditorSelector
        id='tone-selector'
        options={Object.entries(AI_TONE_TYPE_VALUES).map(([key, value]) => ({
          value,
          label: value,
        }))}
        value=''
        onChange={(tone) => onOperation(AI_OPERATION.TONE, { tone })}
        placeholder='Tone'
        placeholderIcon={<SlidersHorizontal className='size-3.5' />}
        disabled={state.isProcessing}
        className='min-w-[100px]'
        contentClassName={popoverClassName}
      />

      {/* Fix Grammar Button */}
      <Button
        variant='outline'
        size='sm'
        onClick={() => onOperation(AI_OPERATION.FIX_GRAMMAR)}
        disabled={state.isProcessing}>
        <SpellCheck2 />
        Fix grammar
      </Button>

      {/* Language Selector */}
      <EditorSelector
        id='language-selector'
        options={Object.entries(AI_LANG_TYPE_VALUES).map(([key, value]) => ({
          value,
          label: value,
        }))}
        value=''
        onChange={(language) => onOperation(AI_OPERATION.TRANSLATE, { language })}
        placeholder='Translate'
        placeholderIcon={<Languages className='size-3.5' />}
        disabled={state.isProcessing}
        className='min-w-[100px]'
        contentClassName={popoverClassName}
      />

      {/* Expand Button */}
      <Button
        variant='outline'
        size='sm'
        onClick={() => onOperation(AI_OPERATION.EXPAND)}
        disabled={state.isProcessing}>
        <UnfoldVertical />
        Expand
      </Button>

      {/* Shorten Button */}
      <Button
        variant='outline'
        size='sm'
        onClick={() => onOperation(AI_OPERATION.SHORTEN)}
        disabled={state.isProcessing}>
        <FoldVertical />
        Shorten
      </Button>
    </div>
  )
}
