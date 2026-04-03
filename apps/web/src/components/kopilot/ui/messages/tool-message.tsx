// apps/web/src/components/kopilot/ui/messages/tool-message.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import type { KopilotMessage } from '../../stores/kopilot-store'

export function ToolMessage({ message }: { message: KopilotMessage }) {
  const [expanded, setExpanded] = useState(false)
  const tool = message.tool
  if (!tool) return null

  const statusIcon = {
    running: <Loader2 className='size-3.5 animate-spin text-muted-foreground' />,
    completed: <Check className='size-3.5 text-emerald-500' />,
    error: <X className='size-3.5 text-destructive' />,
  }[tool.status]

  return (
    <div className='text-xs'>
      <button
        type='button'
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
          'text-muted-foreground hover:bg-muted/50'
        )}>
        <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
        {statusIcon}
        <span className='font-mono'>{tool.name}</span>
      </button>

      {expanded && (
        <div className='ml-6 mt-1 space-y-1'>
          {Object.keys(tool.args).length > 0 && (
            <pre className='overflow-auto rounded bg-muted/50 p-2 text-[11px]'>
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          )}
          {tool.result !== undefined && (
            <pre className='overflow-auto rounded bg-muted/50 p-2 text-[11px]'>
              {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
