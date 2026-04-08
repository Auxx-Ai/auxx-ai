// apps/web/src/components/kopilot/ui/messages/tool-status-pills.tsx

'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { ThinkingGroup } from '../../stores/kopilot-store'
import { ToolStatusPill } from './tool-status-pill'

interface ToolStatusPillsProps {
  group: ThinkingGroup
}

export function ToolStatusPills({ group }: ToolStatusPillsProps) {
  const toolSteps = group.steps.filter((s) => s.tool)
  if (toolSteps.length === 0) return null

  return (
    <div className='flex flex-col gap-1'>
      <AnimatePresence initial={false}>
        {toolSteps.map((step) => (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden' }}>
            <ToolStatusPill step={step} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
