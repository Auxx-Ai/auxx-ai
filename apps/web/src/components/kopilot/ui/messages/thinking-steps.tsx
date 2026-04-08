// apps/web/src/components/kopilot/ui/messages/thinking-steps.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronRight, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { ThinkingGroup } from '../../stores/kopilot-store'
import { ToolStatusPill } from './tool-status-pill'

interface ThinkingStepsProps {
  group: ThinkingGroup
}

export function ThinkingSteps({ group }: ThinkingStepsProps) {
  const isRunning = group.status === 'running'
  const [isOpen, setIsOpen] = useState(isRunning)

  const toolSteps = group.steps.filter((s) => s.tool)
  const completedCount = toolSteps.filter((s) => s.tool?.status === 'completed').length
  const totalCount = toolSteps.length

  if (totalCount === 0) return null

  const headerLabel = isRunning
    ? `Working… (${completedCount}/${totalCount})`
    : totalCount === 1
      ? '1 step completed'
      : `${totalCount} steps completed`

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
        <AnimatePresence mode='popLayout'>
          <motion.span
            key={headerLabel}
            initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
            animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
            exit={{ filter: 'blur(3px)', opacity: 0, y: -6 }}
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
            initial={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
            exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden' }}>
            <div className='flex flex-col gap-1 py-1.5 pl-2'>
              <AnimatePresence initial={false}>
                {group.steps.map((step) => {
                  if (!step.tool) {
                    if (!step.thinking?.trim()) return null
                    return (
                      <motion.p
                        key={step.id}
                        initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
                        animate={{ filter: 'blur(0px)', opacity: 0.7, y: 0 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                        className='pl-2 text-xs text-muted-foreground/70 italic leading-relaxed'>
                        {step.thinking.trim()}
                      </motion.p>
                    )
                  }

                  return (
                    <motion.div
                      key={step.id}
                      initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
                      animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 25 }}>
                      <ToolStatusPill step={step} />
                      {step.thinking?.trim() && (
                        <p className='py-1 pl-2 text-xs text-muted-foreground/70 italic leading-relaxed'>
                          {step.thinking.trim()}
                        </p>
                      )}
                    </motion.div>
                  )
                })}
              </AnimatePresence>

              {/* Pending thinking while running */}
              {isRunning && group.pendingThinking.trim() && (
                <motion.p
                  initial={{ filter: 'blur(3px)', opacity: 0 }}
                  animate={{ filter: 'blur(0px)', opacity: 0.7 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                  className='pl-2 text-xs text-muted-foreground/70 italic leading-relaxed'>
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
