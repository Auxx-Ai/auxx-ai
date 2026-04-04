// apps/web/src/components/kopilot/ui/messages/tool-status-pills.tsx

'use client'

import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { ThinkingGroup } from '../../stores/kopilot-store'
import { ToolStatusPill } from './tool-status-pill'

interface ToolStatusPillsProps {
  group: ThinkingGroup
}

export function ToolStatusPills({ group }: ToolStatusPillsProps) {
  const [showThinking, setShowThinking] = useState(false)
  const isRunning = group.status === 'running'

  const toolSteps = group.steps.filter((s) => s.tool)
  if (toolSteps.length === 0) return null

  // Check if any step has thinking text worth showing
  const hasThinking = group.steps.some((s) => s.thinking?.trim())

  return (
    <div className='mb-1 flex flex-col gap-1'>
      <AnimatePresence initial={false}>
        {group.steps.map((step) => {
          // Pure-thinking steps (no tool) — only show when expanded
          if (!step.tool) {
            if (!showThinking || !step.thinking?.trim()) return null
            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 0.7, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                style={{ overflow: 'hidden' }}>
                <p className='py-1 pl-6 text-xs text-muted-foreground/70 italic leading-relaxed'>
                  {step.thinking.trim()}
                </p>
              </motion.div>
            )
          }

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              style={{ overflow: 'hidden' }}>
              <ToolStatusPill step={step} />
              {/* Show thinking text inline when expanded */}
              {showThinking && step.thinking?.trim() && (
                <p className='py-1 pl-6 text-xs text-muted-foreground/70 italic leading-relaxed'>
                  {step.thinking.trim()}
                </p>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>

      {/* Pending thinking while running */}
      {isRunning && showThinking && group.pendingThinking.trim() && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.7 }}
          className='pl-6 text-xs text-muted-foreground/70 italic leading-relaxed'>
          {group.pendingThinking.trim()}
        </motion.p>
      )}

      {/* Thinking toggle */}
      {hasThinking && (
        <button
          type='button'
          onClick={() => setShowThinking((v) => !v)}
          className='flex items-center gap-0.5 px-2 text-xs text-muted-foreground hover:text-foreground/70'>
          <motion.span
            animate={{ rotate: showThinking ? 90 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
            <ChevronRight className='size-3' />
          </motion.span>
          {showThinking ? 'Hide thinking' : 'Show thinking'}
        </button>
      )}
    </div>
  )
}
