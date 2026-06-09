// apps/web/src/components/evals/ui/eval-trace-event-card.tsx
'use client'

import type { EvalTraceEvent } from '@auxx/types/evals'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Flag,
  MessageSquare,
  User,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'

/**
 * One chronological event in an agent simulation trace. Reuses the
 * `NodeExecutionCard` visual language (status-hued border, expandable, payload
 * block) but with agent event kinds — customer turn, agent reply, tool call
 * (mock badge), system warning/error, terminal. Unknown event types fall back
 * to a generic JSON card so a new emit never renders blank.
 *
 * See plans/evals/ui-plan.md §"Level 3 — run detail + trace".
 */

type Tone = 'neutral' | 'agent' | 'tool' | 'good' | 'warn' | 'error'

const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-border',
  agent: 'border-blue-500/40',
  tool: 'border-violet-500/40',
  good: 'border-good-400/50',
  warn: 'border-amber-500/40 bg-amber-500/5',
  error: 'border-destructive/30 bg-destructive/5',
}

interface Presentation {
  icon: React.ReactNode
  title: string
  tone: Tone
  /** Inline one-liner shown collapsed; the full payload expands below. */
  summary?: string
  badge?: { label: string; className?: string }
}

function present(event: EvalTraceEvent): Presentation {
  const data = event.data as Record<string, unknown>
  const text = typeof data.text === 'string' ? data.text : undefined
  const message = typeof data.message === 'string' ? data.message : undefined

  switch (event.type) {
    case 'customer_message':
      return {
        icon: <User className='size-3.5' />,
        title: 'Customer',
        tone: 'neutral',
        summary: text,
      }
    case 'agent_message':
      return {
        icon: <MessageSquare className='size-3.5' />,
        title: 'Agent',
        tone: 'agent',
        summary: text,
      }
    case 'tool_call': {
      const resolution = typeof data.resolution === 'string' ? data.resolution : 'mock'
      const captured = data.captured === true
      return {
        icon: <Wrench className='size-3.5' />,
        title: typeof data.toolName === 'string' ? data.toolName : 'Tool call',
        tone: 'tool',
        summary: typeof data.outputSummary === 'string' ? data.outputSummary : undefined,
        badge: {
          label: captured ? 'captured' : resolution === 'passthrough' ? 'live' : 'mock',
          className:
            resolution === 'passthrough'
              ? 'border-amber-500/40 text-amber-600'
              : 'text-muted-foreground',
        },
      }
    }
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
    case 'config_invalid':
    case 'snapshot_incompatible':
    case 'code_revision_drift':
      return {
        icon: <AlertTriangle className='size-3.5' />,
        title: event.type.replace(/_/g, ' '),
        tone: 'warn',
        summary: message,
      }
    default:
      return { icon: <ChevronRight className='size-3.5' />, title: event.type, tone: 'neutral' }
  }
}

interface EvalTraceEventCardProps {
  event: EvalTraceEvent
}

export function EvalTraceEventCard({ event }: EvalTraceEventCardProps) {
  const [open, setOpen] = useState(false)
  const copy = useCopy({ toastMessage: 'Event data copied' })
  const p = present(event)
  const payload = JSON.stringify(event.data, null, 2)
  const hasPayload = Object.keys(event.data).length > 0

  return (
    <div className={cn('relative rounded-lg border bg-card', TONE_BORDER[p.tone])}>
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
        <span className='text-muted-foreground'>{p.icon}</span>
        <span className='shrink-0 text-xs font-medium capitalize'>{p.title}</span>
        {p.badge ? (
          <Badge variant='outline' className={cn('h-4 px-1 text-[10px]', p.badge.className)}>
            {p.badge.label}
          </Badge>
        ) : null}
        {p.summary ? (
          <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>{p.summary}</span>
        ) : (
          <span className='flex-1' />
        )}
        <span className='shrink-0 font-mono text-[10px] text-muted-foreground/60'>
          #{event.sequence}
        </span>
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
