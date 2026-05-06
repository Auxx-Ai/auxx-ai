// apps/homepage/src/app/platform/ai/_mocks/mock-assistant-message.tsx

'use client'

import { Fragment, type ReactNode } from 'react'
import { MockSparkleIcon } from './mock-sparkle-icon'
import { MockThinkingSteps } from './mock-thinking-steps'
import type { ThinkingState } from './use-kopilot-story'

interface MockAssistantSlotProps {
  thinking: ThinkingState | null
  /** Rendered between thinking and content. */
  blocks: ReactNode
  /** Plain text with `**bold**` tokens. */
  content: string
  /** Whether to append a trailing block-cursor. */
  streaming: boolean
}

/**
 * Mirrors `apps/web/src/components/kopilot/ui/messages/assistant-message.tsx`'s
 * outer layout: SparkleIcon column + content column with thinking-steps,
 * blocks, then markdown-styled text. No `react-markdown` dep — `formatInline`
 * handles the only token we use (`**bold**`).
 */
export function MockAssistantSlot({
  thinking,
  blocks,
  content,
  streaming,
}: MockAssistantSlotProps) {
  const variant = streaming ? 'generating' : 'generated'
  const hasContent = content.length > 0

  return (
    <div className='group/message flex flex-col gap-2 sm:flex-row'>
      <MockSparkleIcon variant={variant} />
      <div className='min-w-0 flex-1 space-y-1'>
        {thinking && <MockThinkingSteps thinking={thinking} />}
        {blocks}
        {(hasContent || streaming) && (
          <div className='text-sm/5 text-mock-window-foreground'>
            {formatInline(content)}
            {streaming && <span className='animate-dot-blink'>▌</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Tokenize plain text on `**bold**` markers. Anything else passes through
 * verbatim. Keeps newlines as `<br/>` (rare in our scripts but cheap to
 * support) so authors don't have to think about wrapping.
 */
function formatInline(text: string): ReactNode[] {
  if (!text) return []
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className='font-semibold text-foreground'>
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.includes('\n')) {
      const lines = part.split('\n')
      return (
        <Fragment key={i}>
          {lines.map((line, j) => (
            <Fragment key={j}>
              {line}
              {j < lines.length - 1 && <br />}
            </Fragment>
          ))}
        </Fragment>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
