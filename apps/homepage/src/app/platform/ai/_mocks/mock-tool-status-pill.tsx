// apps/homepage/src/app/platform/ai/_mocks/mock-tool-status-pill.tsx

'use client'

import {
  BookOpen,
  Check,
  Database,
  FileText,
  Loader2,
  type LucideIcon,
  Mail,
  Pencil,
  PenTool,
  Plus,
  Search,
  Wrench,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ThinkingStepState, ToolPillIcon } from './use-kopilot-story'

const ICON_MAP: Record<ToolPillIcon, LucideIcon> = {
  Search,
  Wrench,
  Mail,
  BookOpen,
  PenTool,
  Pencil,
  Plus,
  Database,
  FileText,
}

/**
 * Visual port of `apps/web/src/components/kopilot/ui/messages/tool-status-pill.tsx`
 * with a static icon map. Status icon swaps via spring 600/20 between Loader2
 * (running) and Check (completed) — matches the real spec.
 */
export function MockToolStatusPill({ step }: { step: ThinkingStepState }) {
  const Icon = ICON_MAP[step.icon ?? 'Wrench']
  const label = step.status === 'running' ? step.runningLabel : step.completedLabel

  return (
    <div className='inline-flex items-center gap-1.5 rounded-lg border bg-muted/50 px-2 py-1 text-xs'>
      <AnimatePresence mode='wait'>
        <motion.span
          key={step.status}
          className='flex shrink-0 items-center'
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 20 }}>
          {step.status === 'running' ? (
            <Loader2 className='size-3 animate-spin text-muted-foreground' />
          ) : (
            <Check className='size-3 text-emerald-500' />
          )}
        </motion.span>
      </AnimatePresence>
      <Icon className='size-3 shrink-0 text-muted-foreground' />
      <span className='shrink-0 font-medium text-foreground/80'>{label}</span>
    </div>
  )
}
