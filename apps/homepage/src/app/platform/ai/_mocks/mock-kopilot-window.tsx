// apps/homepage/src/app/platform/ai/_mocks/mock-kopilot-window.tsx

'use client'

import { ChevronsUpDown, Send, Sparkles, SquareSlash } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from '~/lib/utils'
import { TurnView } from './turn-view'
import { type KopilotStoryScript, useKopilotStory } from './use-kopilot-story'

interface MockKopilotWindowProps {
  /** Story to play out. */
  script: KopilotStoryScript
  composerPlaceholder?: string
  modelLabel?: string
  className?: string
}

/**
 * Story-mode Kopilot chat surface. Plays a scripted multi-turn conversation
 * driven by `useKopilotStory`. Visual fidelity targets the real components
 * in `apps/web/src/components/kopilot/ui/`.
 *
 * The breadcrumb header has been extracted into `MockKopilotHeader` — render
 * it separately above the panel frame so it can sit flat while the panel
 * lifts in 3D.
 */
export function MockKopilotWindow({
  script,
  composerPlaceholder = 'Ask Kopilot...',
  modelLabel = 'GPT-5.4 Nano',
  className,
}: MockKopilotWindowProps) {
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
      className={cn('flex h-full min-h-0 flex-1 flex-col text-mock-window-foreground', className)}>
      <div
        ref={scrollRef}
        className='no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-4'>
          {state.turns.map((turn, i) => (
            <TurnView key={i} turn={turn} />
          ))}
        </div>
      </div>

      <div className='border-t border-mock-window-border px-3 py-3 sm:px-6'>
        <div className='mx-auto w-full max-w-2xl'>
          <Composer
            typed={state.composer.typed}
            typing={state.status === 'typing'}
            placeholder={composerPlaceholder}
            modelLabel={modelLabel}
          />
        </div>
      </div>
    </div>
  )
}

interface ComposerProps {
  typed: string
  typing: boolean
  placeholder: string
  modelLabel: string
}

function Composer({ typed, typing, placeholder, modelLabel }: ComposerProps) {
  const hasTyped = typed.length > 0
  return (
    <div
      className={cn(
        'relative flex min-h-[120px] flex-row items-end rounded-xl border bg-mock-composer transition-colors',
        typing ? 'border-mock-composer-focus' : 'border-mock-composer-border'
      )}>
      <div className='flex flex-1 flex-col self-stretch px-3 py-2'>
        {hasTyped ? (
          <p className='text-sm text-mock-window-foreground'>
            {typed}
            {typing && <span className='animate-dot-blink ml-px'>▌</span>}
          </p>
        ) : (
          <p className='text-sm text-mock-window-muted'>{placeholder}</p>
        )}
      </div>
      <div className='absolute bottom-1 left-1'>
        <ModelPickerTrigger label={modelLabel} />
      </div>
      <div className='absolute right-1 bottom-1 flex items-center gap-0.5 text-mock-window-muted'>
        <span className='flex size-7 items-center justify-center rounded-xl'>
          <SquareSlash className='size-4' />
        </span>
        <span className='flex size-7 items-center justify-center rounded-xl'>
          <Send className='size-4' />
        </span>
      </div>
    </div>
  )
}

function ModelPickerTrigger({ label }: { label: string }) {
  return (
    <span className='inline-flex h-7 items-center gap-2 rounded-xl bg-transparent px-2 text-xs text-mock-window-muted'>
      <span className='flex size-4 shrink-0 items-center justify-center rounded text-amber-500'>
        <Sparkles className='size-3.5' />
      </span>
      <span className='truncate text-mock-window-foreground'>{label}</span>
      <span className='inline-flex items-center rounded-sm bg-mock-bubble px-1 text-[10px] text-mock-window-muted'>
        ×1
      </span>
      <ChevronsUpDown className='size-3 shrink-0 opacity-50' />
    </span>
  )
}
