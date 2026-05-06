// apps/homepage/src/app/platform/ai/_mocks/mock-thinking-steps.tsx

'use client'

import { ChevronRight, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '~/lib/utils'
import { MockToolStatusPill } from './mock-tool-status-pill'
import type { ThinkingState } from './use-kopilot-story'

/**
 * Visual port of `apps/web/src/components/kopilot/ui/messages/thinking-steps.tsx`.
 * Externally controlled — `running` and `expanded` come from the script driver.
 */
export function MockThinkingSteps({ thinking }: { thinking: ThinkingState }) {
  const { steps, running, expanded } = thinking
  const completedCount = steps.filter((s) => s.status === 'completed').length
  const total = steps.length

  if (total === 0) return null

  const headerLabel = running
    ? `Working… (${completedCount}/${total})`
    : total === 1
      ? '1 step completed'
      : `${total} steps completed`

  return (
    <div className='mb-1'>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md px-1 py-0.5 text-xs',
          'text-muted-foreground'
        )}>
        {running && <Loader2 className='size-3 animate-spin' />}
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
      </div>

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
                {steps.map((step, i) => (
                  <motion.div
                    key={i}
                    initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
                    animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 25 }}>
                    <MockToolStatusPill step={step} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
