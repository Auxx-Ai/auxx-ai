// apps/web/src/components/kopilot/ui/messages/tool-status-pill.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { EvalSuiteProgressSecondary } from './eval-suite-progress'
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
    /** Async-task watch ref from the tool output — drives live progress secondaries. */
    taskNotification?: { kind: string; ref: string }
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
  /**
   * Raw tool output payload. When set, the secondary becomes a capped-width
   * preview and a chevron button toggles a pretty-printed JSON panel below
   * the pill row (evals trace; kopilot omits it).
   */
  expandableOutput?: unknown
  /** Small trailing badge rendered inside the pill (e.g. eval resolution). */
  badge?: { label: string; tone?: 'muted' | 'info' | 'warn' }
}

const badgeToneClasses = {
  muted: 'text-muted-foreground',
  info: 'border-blue-500/40 text-blue-600',
  warn: 'border-amber-500/40 text-amber-600',
} as const

/** Pretty-print the expandable payload; strings render verbatim. */
function formatOutput(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export function ToolStatusPill({
  step,
  iconId,
  color,
  displayName,
  expandableOutput,
  badge,
}: ToolStatusPillProps) {
  const [expanded, setExpanded] = useState(false)
  if (!step.tool) return null

  const expandable = expandableOutput !== undefined

  const { name, args, status, summary, taskNotification } = step.tool
  const config = getToolPillConfig(name, { displayName })
  const resolvedIconId = iconId ?? config.icon ?? 'wrench'

  const labelData =
    status === 'running'
      ? config.labels.running(args)
      : status === 'completed'
        ? config.labels.completed(args, summary)
        : config.labels.error()

  // Per-kind live progress (evals 5D.3): an eval-suite watch upgrades the
  // static secondary to suite counters while the batch runs.
  const liveSecondary =
    status === 'completed' && taskNotification?.kind === 'eval-suite' ? (
      <EvalSuiteProgressSecondary suiteRunId={taskNotification.ref} />
    ) : null

  return (
    <div className='inline-flex max-w-full flex-col rounded-lg bg-muted/50 text-xs border'>
      <div className='flex items-center gap-1.5 px-2 py-1'>
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
        {liveSecondary ??
          (labelData.secondary && (
            <span className={cn('truncate text-muted-foreground', expandable && 'max-w-56')}>
              {labelData.secondary}
            </span>
          ))}
        {badge && (
          <span
            className={cn(
              'inline-flex h-4 shrink-0 items-center rounded-md border px-1 text-[10px] font-medium',
              badgeToneClasses[badge.tone ?? 'muted']
            )}>
            {badge.label}
          </span>
        )}
        {expandable && (
          <button
            type='button'
            aria-label={expanded ? 'Collapse output' : 'Expand output'}
            onClick={() => setExpanded((v) => !v)}
            className='flex shrink-0 items-center text-muted-foreground hover:text-foreground'>
            <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expandable && expanded && (
          <motion.div
            key='output'
            initial={{ height: 0, width: 0, opacity: 0, filter: 'blur(3px)' }}
            animate={{ height: 'auto', width: 'auto', opacity: 1, filter: 'blur(0px)' }}
            exit={{ height: 0, width: 0, opacity: 0, filter: 'blur(3px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden' }}>
            <pre className='max-h-64 overflow-auto whitespace-pre-wrap break-all border-t px-2 py-1.5 text-left font-mono text-[11px] text-muted-foreground'>
              {formatOutput(expandableOutput)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
