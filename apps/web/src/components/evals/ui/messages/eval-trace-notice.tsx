// apps/web/src/components/evals/ui/messages/eval-trace-notice.tsx

'use client'

import type { EvalTraceEvent } from '@auxx/types/evals'
import { Button } from '@auxx/ui/components/button'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Check, ChevronRight, Copy, Flag } from 'lucide-react'
import { useState } from 'react'

/**
 * A non-conversational trace event — terminal outcome, execution error, or a
 * config/snapshot warning — rendered as an inline status row inside the agent
 * turn. Keeps the tone-hued border from the original trace card and the
 * raw-JSON expander so any event's full `data` stays inspectable for debugging.
 */

type Tone = 'good' | 'warn' | 'error'

const TONE_BORDER: Record<Tone, string> = {
  good: 'border-good-400/50',
  warn: 'border-amber-500/40 bg-amber-500/5',
  error: 'border-destructive/30 bg-destructive/5',
}

interface Notice {
  icon: React.ReactNode
  title: string
  tone: Tone
  summary?: string
}

function present(event: EvalTraceEvent): Notice {
  const data = event.data
  const message = typeof data.message === 'string' ? data.message : undefined

  switch (event.type) {
    case 'terminal': {
      const outcome = typeof data.terminalOutcome === 'string' ? data.terminalOutcome : 'none'
      const capExceeded = data.capExceeded === true
      return {
        icon: <Flag className='size-3.5' />,
        title: 'Terminal',
        tone: capExceeded ? 'warn' : 'good',
        summary: capExceeded ? 'Customer-turn cap reached' : `Outcome: ${outcome}`,
      }
    }
    case 'execution_error':
      return {
        icon: <AlertTriangle className='size-3.5' />,
        title: 'Execution error',
        tone: 'error',
        summary: message,
      }
    default:
      return {
        icon: <AlertTriangle className='size-3.5' />,
        title: event.type.replace(/_/g, ' '),
        tone: 'warn',
        summary: message,
      }
  }
}

export function EvalTraceNotice({ event }: { event: EvalTraceEvent }) {
  const [open, setOpen] = useState(false)
  const copy = useCopy({ toastMessage: 'Event data copied' })
  const n = present(event)
  const payload = JSON.stringify(event.data, null, 2)
  const hasPayload = Object.keys(event.data).length > 0

  return (
    <div className={cn('relative rounded-lg border bg-card', TONE_BORDER[n.tone])}>
      <button
        type='button'
        onClick={() => hasPayload && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
          hasPayload && 'cursor-pointer'
        )}>
        {hasPayload ? (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
        ) : (
          <span className='w-3 shrink-0' />
        )}
        <span className='text-muted-foreground'>{n.icon}</span>
        <span className='shrink-0 text-xs font-medium capitalize'>{n.title}</span>
        {n.summary ? (
          <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>{n.summary}</span>
        ) : (
          <span className='flex-1' />
        )}
      </button>

      {open && hasPayload ? (
        <div className='relative border-t px-2.5 py-2'>
          <Button
            variant='ghost'
            size='icon-xs'
            className='absolute right-1.5 top-1.5 text-muted-foreground'
            onClick={() => copy.copy(payload)}
            aria-label='Copy event data'>
            {copy.copied ? <Check /> : <Copy />}
          </Button>
          <pre className='max-h-[280px] overflow-auto font-mono text-[11px] leading-relaxed'>
            {payload}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
