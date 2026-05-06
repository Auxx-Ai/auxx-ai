// apps/homepage/src/app/platform/ai/_mocks/mock-kopilot-prompt-story.tsx

'use client'

import { useEffect, useRef } from 'react'
import { cn } from '~/lib/utils'
import { TurnView } from './turn-view'
import { type KopilotStoryScript, useKopilotStory } from './use-kopilot-story'

interface MockKopilotPromptStoryProps {
  /** Story to play out. */
  script: KopilotStoryScript
  className?: string
}

/**
 * Composer-less story view used by the personas section. Plays out a
 * `KopilotStoryScript` (multiple turns) inside a fixed-height card with the
 * scrollbar hidden — same TurnView that powers `MockKopilotWindow`, just
 * without the breadcrumb header or composer.
 */
export function MockKopilotPromptStory({ script, className }: MockKopilotPromptStoryProps) {
  const { state, ref } = useKopilotStory<HTMLDivElement>(script)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Smooth-scroll the chat region to the bottom as new content streams in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only deps
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [state.turns, state.status])

  return (
    <div
      ref={ref}
      className={cn(
        'flex h-[460px] min-h-0 flex-col overflow-hidden rounded-xl border-none sm:border border-mock-window-border bg-transparent sm:bg-mock-card text-mock-window-foreground shadow-sm',
        className
      )}>
      <div ref={scrollRef} className='no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4'>
        <div className='flex flex-col gap-3'>
          {state.turns.map((turn, i) => (
            <TurnView key={i} turn={turn} />
          ))}
        </div>
      </div>
    </div>
  )
}
