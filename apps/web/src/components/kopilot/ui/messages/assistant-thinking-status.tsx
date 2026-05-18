// apps/web/src/components/kopilot/ui/messages/assistant-thinking-status.tsx

'use client'

import { TextShimmer } from '@auxx/ui/components/text-shimmer'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useKopilotStore } from '../../stores/kopilot-store'

const SPINNER_VERBS = [
  'Actioning',
  'Actualizing',
  'Architecting',
  'Baking',
  'Brewing',
  'Calculating',
  'Cascading',
  'Composing',
  'Computing',
  'Cooking',
  'Doodling',
  'Generating',
  'Orchestrating',
  'Thinking',
  'Working',
]

function getRandomVerb() {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)]!
}

/**
 * Inline "model is working" indicator rendered inside an assistant bubble
 * when there are no runs to show yet. Replaces the previous bottom
 * `KopilotStatusBar` so feedback lives next to the sparkle that owns it.
 */
export function AssistantThinkingStatus() {
  const currentAgent = useKopilotStore((s) => s.stream.currentAgent)
  const [verb, setVerb] = useState(getRandomVerb)

  useEffect(() => {
    setVerb(getRandomVerb())
    const interval = setInterval(() => setVerb(getRandomVerb()), 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className='flex items-center gap-1.5 text-xs'>
      <Loader2 className='size-3 animate-spin' />
      <TextShimmer as='span'>{verb}</TextShimmer>
      {!currentAgent && <AnimatedDots />}
    </div>
  )
}

export function AnimatedDots() {
  return (
    <span className='inline-flex w-4'>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className='animate-dot-blink text-muted-foreground'
          style={{ animationDelay: `${i * 300}ms` }}>
          .
        </span>
      ))}
    </span>
  )
}
