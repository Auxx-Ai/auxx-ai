// apps/web/src/components/kopilot/ui/kopilot-status-bar.tsx

'use client'

import { TextShimmer } from '@auxx/ui/components/text-shimmer'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useKopilotStore } from '../stores/kopilot-store'

export const SPINNER_VERBS = [
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

interface KopilotStatusBarProps {
  contentClassName?: string
}

export function KopilotStatusBar({ contentClassName }: KopilotStatusBarProps) {
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const currentAgent = useKopilotStore((s) => s.stream.currentAgent)
  // const activeTools = useKopilotStore((s) => s.stream.activeTools)
  // const activeTool = activeTools[0]

  const [verb, setVerb] = useState(getRandomVerb)

  useEffect(() => {
    if (!isStreaming) return
    setVerb(getRandomVerb())
    const interval = setInterval(() => setVerb(getRandomVerb()), 3000)
    return () => clearInterval(interval)
  }, [isStreaming])

  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-200',
        isStreaming ? 'h-8' : 'h-0 border-t-0'
      )}>
      <div className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs', contentClassName)}>
        <Loader2 className='size-3 animate-spin' />
        <TextShimmer text={currentAgent ?? verb} />
        {!currentAgent && <AnimatedDots />}
        {/* {activeTool && (
          <>
            <span>•</span>
            <span className='font-mono'>{activeTool.tool}</span>
          </>
        )} */}
      </div>
    </div>
  )
}

function AnimatedDots() {
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
