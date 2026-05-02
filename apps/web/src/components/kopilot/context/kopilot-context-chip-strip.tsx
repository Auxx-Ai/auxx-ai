// apps/web/src/components/kopilot/context/kopilot-context-chip-strip.tsx

'use client'

import { Building2, FileText, Filter, Inbox, Mail, Mic, User, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useKopilotStore } from '../stores/kopilot-store'
import { useKopilotContextChips } from '../stores/select-context'
import type { ContextChipIcon } from './types'

const ICONS: Record<ContextChipIcon, typeof Mail> = {
  mail: Mail,
  user: User,
  building: Building2,
  mic: Mic,
  file: FileText,
  filter: Filter,
}

const SPRING = { type: 'spring', stiffness: 220, damping: 26 } as const
const REDUCED = { duration: 0.12 } as const

/**
 * Chip strip rendered above the composer input. Hides while Kopilot is
 * "thinking..." (the status bar takes that visual space). Each chip is the
 * UI representation of a registered SessionContext field; × dismisses it for
 * the next turn only.
 */
export function KopilotContextChipStrip() {
  const chips = useKopilotContextChips()
  const dismissed = useKopilotStore((s) => s.dismissedChipKeys)
  const dismiss = useKopilotStore((s) => s.dismissChip)
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const prefersReducedMotion = useReducedMotion()

  const visible = chips.filter((c) => !dismissed.has(`${c.field}:${c.value}`))
  const showStrip = !isStreaming && visible.length > 0

  const transition = prefersReducedMotion ? REDUCED : SPRING

  return (
    <AnimatePresence initial={false}>
      {showStrip && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
          transition={transition}
          style={{ overflow: 'hidden' }}>
          <div className='flex flex-wrap gap-1.5 px-3 pt-2 pb-1'>
            <AnimatePresence initial={true}>
              {visible.map((chip, i) => {
                const Icon = chip.icon ? ICONS[chip.icon] : Inbox
                const key = `${chip.field}:${chip.value}`
                const chipTransition = prefersReducedMotion
                  ? REDUCED
                  : { ...SPRING, delay: i * 0.04 }
                return (
                  <motion.span
                    key={key}
                    layout
                    initial={
                      prefersReducedMotion
                        ? { opacity: 0 }
                        : { opacity: 0, y: 8, filter: 'blur(3px)' }
                    }
                    animate={
                      prefersReducedMotion
                        ? { opacity: 1 }
                        : { opacity: 1, y: 0, filter: 'blur(0px)' }
                    }
                    exit={
                      prefersReducedMotion
                        ? { opacity: 0 }
                        : { opacity: 0, y: 4, filter: 'blur(3px)' }
                    }
                    transition={chipTransition}
                    className='inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground'>
                    <Icon className='size-3' />
                    <span className='max-w-[160px] truncate'>{chip.label ?? chip.value}</span>
                    <button
                      type='button'
                      className='ml-0.5 rounded p-0.5 hover:bg-muted'
                      onClick={() => dismiss(key)}
                      aria-label='Remove from Kopilot context'>
                      <X className='size-3' />
                    </button>
                  </motion.span>
                )
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
