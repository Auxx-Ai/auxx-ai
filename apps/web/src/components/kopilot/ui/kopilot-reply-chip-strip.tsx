// apps/web/src/components/kopilot/ui/kopilot-reply-chip-strip.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useKopilotStore } from '../stores/kopilot-store'

interface KopilotReplyChipStripProps {
  /**
   * Invoked when the user taps a chip. Receives the chip label, which the
   * caller submits as the next user message. The strip clears its state
   * automatically — the chip is one-shot per turn.
   */
  onSelect: (label: string) => void
}

const SPRING = { type: 'spring', stiffness: 220, damping: 26 } as const
const REDUCED = { duration: 0.12 } as const

/**
 * Renders the `suggest_replies` chip strip above the composer. Visible only
 * when the most recent tool result included an `_suggestReplies` snapshot.
 * Tapping a chip both fires the handler and clears the pending list.
 */
export function KopilotReplyChipStrip({ onSelect }: KopilotReplyChipStripProps) {
  const prompts = useKopilotStore((s) => s.pendingChipPrompts)
  const clearPendingChipPrompts = useKopilotStore((s) => s.clearPendingChipPrompts)
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const prefersReducedMotion = useReducedMotion()

  const visible = !isStreaming && prompts.length > 0
  const transition = prefersReducedMotion ? REDUCED : SPRING

  const handleClick = (label: string) => {
    clearPendingChipPrompts()
    onSelect(label)
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
          transition={transition}
          style={{ overflow: 'hidden' }}>
          <div className='flex flex-wrap gap-1.5 pt-2 pb-1'>
            {prompts.map((p) => (
              <motion.button
                key={p.id}
                type='button'
                onClick={() => handleClick(p.label)}
                initial={
                  prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(3px)' }
                }
                animate={
                  prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }
                }
                exit={
                  prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(3px)' }
                }
                transition={transition}
                className={cn(
                  'rounded-full border bg-background px-3 py-1 text-xs',
                  'text-muted-foreground hover:text-foreground hover:border-info',
                  'cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-info'
                )}>
                {p.label}
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
