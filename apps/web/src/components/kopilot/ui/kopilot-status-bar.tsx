// apps/web/src/components/kopilot/ui/kopilot-status-bar.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Loader2 } from 'lucide-react'
import { useKopilotStore } from '../stores/kopilot-store'

interface KopilotStatusBarProps {
  contentClassName?: string
}

export function KopilotStatusBar({ contentClassName }: KopilotStatusBarProps) {
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const currentAgent = useKopilotStore((s) => s.stream.currentAgent)
  const activeTools = useKopilotStore((s) => s.stream.activeTools)

  const activeTool = activeTools[0]

  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-200',
        isStreaming ? 'h-8' : 'h-0 border-t-0'
      )}>
      <div
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground',
          contentClassName
        )}>
        <Loader2 className='size-3 animate-spin' />
        <span>{currentAgent ?? 'Thinking...'}</span>
        {activeTool && (
          <>
            <span>•</span>
            <span className='font-mono'>{activeTool.tool}</span>
          </>
        )}
      </div>
    </div>
  )
}
