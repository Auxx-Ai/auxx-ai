// apps/homepage/src/app/platform/ai/_mocks/mock-blocks/plan-steps-block.tsx

'use client'

import { Check, Circle, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { PlanStepRow } from '../use-kopilot-story'
import { MockBlockCard } from './block-card'

const STATUS_ICONS = {
  completed: <Check className='size-3.5 text-green-500' />,
  running: <Loader2 className='size-3.5 animate-spin text-blue-500' />,
  failed: <X className='size-3.5 text-destructive' />,
  pending: <Circle className='size-3.5 text-muted-foreground/50' />,
} as const

/**
 * Visual port of `apps/web/src/components/kopilot/ui/blocks/plan-steps-block.tsx`.
 */
export function MockPlanStepsBlock({ steps }: { steps: PlanStepRow[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className='not-prose my-2'>
      <MockBlockCard primaryText='Plan'>
        <div className='space-y-1.5'>
          {steps.map((step, i) => (
            <motion.div
              key={i}
              className='flex items-start gap-2 text-sm'
              initial={{ opacity: 0, x: -8, filter: 'blur(3px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 22,
                delay: Math.min(i * 0.05, 0.3),
              }}>
              <AnimatePresence mode='wait'>
                <motion.span
                  key={step.status}
                  className='mt-0.5 shrink-0'
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}>
                  {STATUS_ICONS[step.status]}
                </motion.span>
              </AnimatePresence>
              <div className='min-w-0'>
                <span className={step.status === 'pending' ? 'text-muted-foreground' : ''}>
                  {step.label}
                </span>
                {step.detail && (
                  <span className='ml-1 text-xs text-muted-foreground'>— {step.detail}</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </MockBlockCard>
    </motion.div>
  )
}
