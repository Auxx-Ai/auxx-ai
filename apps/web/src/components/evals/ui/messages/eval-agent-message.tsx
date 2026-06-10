// apps/web/src/components/evals/ui/messages/eval-agent-message.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useToolAppResolver } from '~/components/kopilot/hooks/use-tool-app-resolver'
import { ToolStatusPill } from '~/components/kopilot/ui/messages/tool-status-pill'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import type { Run } from './eval-trace-grouping'
import { EvalTraceNotice } from './eval-trace-notice'
// Shared chat prose styling so trace markdown matches the kopilot transcript.
import '~/components/kopilot/styles/kopilot-prose.css'

/**
 * The agent's side of one conversation turn in a simulation trace. Mirrors
 * kopilot's `AssistantMessage` layout (sparkle avatar + indented column) but
 * reads from the pure {@link Run} projection: each agent reply is a left-aligned
 * markdown bubble (settled, not streamed — eval SSE delivers whole events, never
 * token deltas), with always-expanded reused {@link ToolStatusPill}s rendered
 * inline between bubbles for tool work, and {@link EvalTraceNotice} rows for
 * terminal/error/system events.
 */
export function EvalAgentMessage({ runs }: { runs: Run[] }) {
  const { resolve } = useToolAppResolver()

  return (
    <div className='flex gap-2 px-3'>
      <SparkleIcon />
      <div className='min-w-0 flex-1 space-y-1.5'>
        {runs.map((run) => {
          if (run.kind === 'agent_text') {
            if (!run.text.trim()) return null
            return (
              <div
                key={run.id}
                className='kopilot-prose w-fit max-w-[90%] rounded-r-xl rounded-bl rounded-tl-xl border bg-card px-3 py-2 text-sm/5 shadow-sm'>
                <Markdown remarkPlugins={[remarkGfm]}>{run.text}</Markdown>
              </div>
            )
          }
          if (run.kind === 'tool_calls') {
            return (
              <div key={run.id} className='flex flex-col gap-1 pl-2'>
                {run.calls.map((call) => {
                  const resolved = resolve(call.name)
                  return (
                    <div key={call.id} className='flex items-center gap-1.5'>
                      <ToolStatusPill
                        step={{
                          id: call.id,
                          tool: {
                            name: call.name,
                            args: call.args,
                            status: 'completed',
                            summary: call.summary,
                          },
                        }}
                        iconId={resolved?.iconId}
                        color={resolved?.color}
                        displayName={resolved?.displayName}
                      />
                      <Badge
                        variant='outline'
                        className={cn(
                          'h-4 px-1 text-[10px]',
                          call.badge.live
                            ? 'border-amber-500/40 text-amber-600'
                            : 'text-muted-foreground'
                        )}>
                        {call.badge.label}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            )
          }
          return <EvalTraceNotice key={run.id} event={run.event} />
        })}
      </div>
    </div>
  )
}
