// apps/web/src/components/kopilot/ui/messages/tool-status-pill.tsx

'use client'

import { Check, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { getToolPillConfig } from './tool-status-pill-config'

/**
 * Local mirror of the legacy `ThinkingStep` shape that this pill consumes.
 * Callers (the thinking-steps renderer) project ToolCallParts onto this shape
 * before rendering; the pill itself doesn't know about ContentPart.
 */
interface ThinkingStep {
  id: string
  tool?: {
    name: string
    args: Record<string, unknown>
    status: 'running' | 'completed' | 'error'
    summary?: string
    entities?: Array<{ recordId: string }>
  }
}

interface ToolStatusPillProps {
  step: ThinkingStep
  /**
   * Resolved icon for the tool, in `<AppIcon iconId>` shape (Lucide name,
   * url:..., https:// URL, base64, or emoji). Supplied by `thinking-steps`
   * via `useToolAppResolver` for app-backed tools; built-in tools fall back
   * to the per-tool config's Lucide name, or the generic `'wrench'`.
   */
  iconId?: string | null
  color?: string
  /**
   * Human label for app-backed tools (e.g. "Search Google Contacts"). Used
   * by the fallback config when no per-tool entry exists so labels never
   * include the snake-case `appSlug_` prefix.
   */
  displayName?: string
}

export function ToolStatusPill({ step, iconId, color, displayName }: ToolStatusPillProps) {
  if (!step.tool) return null

  const { name, args, status, summary } = step.tool
  const config = getToolPillConfig(name, { displayName })
  const resolvedIconId = iconId ?? config.icon ?? 'wrench'

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
          transition={{ type: 'spring', stiffness: 600, damping: 20 }}>
          {status === 'running' && (
            <Loader2 className='size-3 animate-spin text-muted-foreground' />
          )}
          {status === 'completed' && <Check className='size-3 text-emerald-500' />}
          {status === 'error' && <X className='size-3 text-destructive' />}
        </motion.span>
      </AnimatePresence>
      <AppIcon iconId={resolvedIconId} color={color} size='xs' />
      <span className='font-medium text-foreground/80 shrink-0'>{labelData.label}</span>
      {labelData.secondary && (
        <span className='truncate text-muted-foreground'>{labelData.secondary}</span>
      )}
    </div>
  )
}
