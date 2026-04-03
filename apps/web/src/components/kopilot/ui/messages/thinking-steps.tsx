// apps/web/src/components/kopilot/ui/messages/thinking-steps.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import type { ThinkingGroup } from '../../stores/kopilot-store'

interface ThinkingStepsProps {
  group: ThinkingGroup
}

export function ThinkingSteps({ group }: ThinkingStepsProps) {
  const isRunning = group.status === 'running'
  const [isOpen, setIsOpen] = useState(isRunning)

  const toolSteps = group.steps.filter((s) => s.tool)
  const completedCount = toolSteps.filter((s) => s.tool?.status === 'completed').length
  const totalCount = toolSteps.length

  const headerLabel = isRunning
    ? totalCount === 0
      ? 'Thinking…'
      : `Working… (${completedCount}/${totalCount})`
    : totalCount === 1
      ? '1 step completed'
      : `${totalCount} steps completed`

  // Auto-expand while running, allow manual toggle
  const expanded = isRunning || isOpen

  return (
    <div className='mb-1'>
      <button
        type='button'
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-colors',
          'text-muted-foreground hover:bg-muted/50'
        )}>
        <ChevronRight
          className={cn('size-3 transition-transform duration-200', expanded && 'rotate-90')}
        />
        {isRunning && <Loader2 className='size-3 animate-spin' />}
        <span>{headerLabel}</span>
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-in-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}>
        <div className='overflow-hidden'>
          <div className='space-y-2 py-1.5 pl-2'>
            {group.steps.map((step) => (
              <div key={step.id} className='animate-in fade-in slide-in-from-top-1 duration-200'>
                {step.thinking && (
                  <p className='text-xs text-muted-foreground/70 italic leading-relaxed'>
                    {step.thinking}
                  </p>
                )}
                {step.tool && <ToolStepRow tool={step.tool} />}
              </div>
            ))}
            {/* Show pending thinking text while running */}
            {isRunning && group.pendingThinking.trim() && (
              <p className='text-xs text-muted-foreground/70 italic leading-relaxed animate-in fade-in duration-200'>
                {group.pendingThinking.trim()}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolStepRow({
  tool,
}: {
  tool: NonNullable<import('../../stores/kopilot-store').ThinkingStep['tool']>
}) {
  const statusIcon = {
    running: <Loader2 className='size-3 shrink-0 animate-spin text-muted-foreground' />,
    completed: <Check className='size-3 shrink-0 text-emerald-500' />,
    error: <X className='size-3 shrink-0 text-destructive' />,
  }[tool.status]

  return (
    <div className='flex items-start gap-1.5 text-xs'>
      <span className='mt-0.5'>{statusIcon}</span>
      <div className='min-w-0'>
        <span className='font-medium text-foreground/80'>{formatToolName(tool.name)}</span>
        {tool.summary && <p className='text-muted-foreground/70 truncate'>{tool.summary}</p>}
      </div>
    </div>
  )
}

/** Convert snake_case tool name to a readable label */
function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
