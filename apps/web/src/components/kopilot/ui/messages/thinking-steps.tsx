// apps/web/src/components/kopilot/ui/messages/thinking-steps.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
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
          'flex items-center gap-1 rounded-md px-1 py-0.5 text-xs',
          'text-muted-foreground hover:bg-muted/50'
        )}>
        {isRunning && <Loader2 className='size-3 animate-spin' />}
        <AnimatePresence mode='wait'>
          <motion.span
            key={headerLabel}
            initial={{ filter: 'blur(4px)', opacity: 0, y: 4 }}
            animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
            exit={{ filter: 'blur(4px)', opacity: 0, y: -4 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}>
            {headerLabel}
          </motion.span>
        </AnimatePresence>
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
          <ChevronRight className='size-3' />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden' }}>
            <div className='space-y-2 py-1.5 pl-2'>
              {group.steps.map((step) => (
                <motion.div
                  key={step.id}
                  initial={{ filter: 'blur(4px)', opacity: 0, y: 8 }}
                  animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
                  {step.thinking && (
                    <p className='text-xs text-muted-foreground/70 italic leading-relaxed'>
                      {step.thinking}
                    </p>
                  )}
                  {step.tool && <ToolStepRow tool={step.tool} />}
                </motion.div>
              ))}
              {/* Show pending thinking text while running */}
              {isRunning && group.pendingThinking.trim() && (
                <motion.p
                  initial={{ filter: 'blur(3px)', opacity: 0 }}
                  animate={{ filter: 'blur(0px)', opacity: 0.7 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                  className='text-xs text-muted-foreground/70 italic leading-relaxed'>
                  {group.pendingThinking.trim()}
                </motion.p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
      <AnimatePresence mode='wait'>
        <motion.span
          key={tool.status}
          className='mt-0.5'
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
          {statusIcon}
        </motion.span>
      </AnimatePresence>
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
