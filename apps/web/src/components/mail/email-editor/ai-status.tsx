// apps/web/src/components/mail/email-editor/ai-status.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Loader2, Redo, Undo } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { AIToolsState } from './hooks/use-ai-tools-state'

interface AIStatusProps {
  state: AIToolsState
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/**
 * AI Status component for displaying undo/redo controls and processing status
 * This component is separated from the main AI tools to be displayed in the editor header
 */
export function AIStatus({ state, canUndo, canRedo, onUndo, onRedo }: AIStatusProps) {
  // Don't show anything if there's no history and not processing
  if (!canUndo && !canRedo && !state.isProcessing) {
    return null
  }

  return (
    <div className='flex items-center gap-1'>
      {/* Loading Indicator */}
      {state.isProcessing && (
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          <span className='text-xs'>
            {state.currentOperation
              ? `Processing ${state.currentOperation.toLowerCase()}...`
              : 'Processing...'}
          </span>
        </div>
      )}
      {/* Undo/Redo Controls */}
      {(canUndo || canRedo) && (
        <div className='flex items-center gap-1'>
          <Tooltip content='Undo AI change' side='bottom'>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={onUndo}
              disabled={!canUndo || state.isProcessing}
              className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'>
              <Undo />
            </Button>
          </Tooltip>
          <Tooltip content='Redo AI change' side='bottom'>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={onRedo}
              disabled={!canRedo || state.isProcessing}
              className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'>
              <Redo />
            </Button>
          </Tooltip>
        </div>
      )}

      {/* Error indicator if present */}
      {state.error && !state.isProcessing && (
        <div className='text-xs text-destructive'>AI operation failed</div>
      )}
    </div>
  )
}
