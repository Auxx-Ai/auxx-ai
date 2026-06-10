// apps/web/src/components/evals/ui/eval-trace-view.tsx
'use client'

import type { EvalTraceEvent } from '@auxx/types/evals'
import { EmptySection } from '@auxx/ui/components/section'
import { Activity } from 'lucide-react'
import { EvalAgentMessage } from './messages/eval-agent-message'
import { EvalCustomerMessage } from './messages/eval-customer-message'
import { groupTrace } from './messages/eval-trace-grouping'

/**
 * The chronological trace of an agent simulation run, rendered as a
 * conversation — the customer's turns as right-aligned bubbles, the agent's
 * replies/tool work/notices in a sparkle-avatar column, matching the kopilot
 * transcript (`kopilot-message-list.tsx`). Live (via the run store) or replayed
 * from the persisted row; the view is a pure render of whatever events it's
 * handed via {@link groupTrace}.
 */

interface EvalTraceViewProps {
  trace: EvalTraceEvent[]
  /** True while the run is still streaming — shows a trailing pulse. */
  isLive?: boolean
}

export function EvalTraceView({ trace, isLive }: EvalTraceViewProps) {
  if (trace.length === 0) {
    return (
      <EmptySection
        icon={<Activity className='size-4' />}
        title={isLive ? 'Waiting for events…' : 'No trace'}
        description={
          isLive
            ? 'The run is starting up. Events will appear here as they happen.'
            : 'This run recorded no trace events.'
        }
        loading={isLive}
      />
    )
  }

  const turns = groupTrace(trace)

  return (
    <div className='flex flex-col gap-3'>
      {turns.map((turn) =>
        turn.kind === 'customer' ? (
          <EvalCustomerMessage key={turn.id} text={turn.text} />
        ) : (
          <EvalAgentMessage key={turn.id} runs={turn.runs} />
        )
      )}
      {isLive ? (
        <div className='flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground'>
          <span className='inline-block size-2 animate-pulse rounded-full bg-blue-500' />
          Running…
        </div>
      ) : null}
    </div>
  )
}
