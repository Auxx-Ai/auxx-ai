// apps/web/src/components/kopilot/ui/messages/tool-status-pill.tsx

'use client'

import {
  BookOpen,
  Check,
  Columns3,
  Database,
  FileText,
  LayoutGrid,
  Loader2,
  type LucideIcon,
  Mail,
  MailCheck,
  MailOpen,
  Pencil,
  PencilLine,
  PenTool,
  Plus,
  Search,
  Send,
  Wrench,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ThinkingStep } from '../../stores/kopilot-store'
import { getToolPillConfig } from './tool-status-pill-config'

const iconMap: Record<string, LucideIcon> = {
  Mail,
  MailOpen,
  MailCheck,
  PenTool,
  Send,
  BookOpen,
  LayoutGrid,
  Columns3,
  Search,
  Database,
  FileText,
  Plus,
  Pencil,
  PencilLine,
  Wrench,
}

interface ToolStatusPillProps {
  step: ThinkingStep
}

export function ToolStatusPill({ step }: ToolStatusPillProps) {
  if (!step.tool) return null

  const { name, args, status, summary } = step.tool
  const config = getToolPillConfig(name)
  const Icon = iconMap[config.icon] ?? Wrench

  const labelData =
    status === 'running'
      ? config.labels.running(args)
      : status === 'completed'
        ? config.labels.completed(args, summary)
        : config.labels.error()

  return (
    <div className='inline-flex items-center gap-1.5 rounded-lg bg-muted/50 px-2 py-1 text-xs border'>
      <AnimatePresence mode='wait'>
        <motion.span
          key={status}
          className='flex shrink-0 items-center'
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
          {status === 'running' && (
            <Loader2 className='size-3 animate-spin text-muted-foreground' />
          )}
          {status === 'completed' && <Check className='size-3 text-emerald-500' />}
          {status === 'error' && <X className='size-3 text-destructive' />}
        </motion.span>
      </AnimatePresence>
      <Icon className='size-3 shrink-0 text-muted-foreground' />
      <span className='font-medium text-foreground/80 shrink-0'>{labelData.label}</span>
      {labelData.secondary && (
        <span className='truncate text-muted-foreground'>{labelData.secondary}</span>
      )}
    </div>
  )
}
