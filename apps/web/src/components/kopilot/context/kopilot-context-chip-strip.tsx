// apps/web/src/components/kopilot/context/kopilot-context-chip-strip.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useHotkey } from '@tanstack/react-hotkeys'
import { Book, Building2, FileText, Filter, Inbox, Mail, Mic, User, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
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
  book: Book,
}

const SPRING = { type: 'spring', stiffness: 220, damping: 26 } as const
const REDUCED = { duration: 0.12 } as const

/**
 * Chip strip rendered above the composer input. Hides while Kopilot is
 * "thinking..." (the status bar takes that visual space). Each chip is the
 * UI representation of a registered SessionContext field; clicking the X (or
 * selecting and pressing Delete/Backspace) dismisses it for the next turn only.
 */
export function KopilotContextChipStrip() {
  const chips = useKopilotContextChips()
  const dismissed = useKopilotStore((s) => s.dismissedChipKeys)
  const dismiss = useKopilotStore((s) => s.dismissChip)
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const prefersReducedMotion = useReducedMotion()

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [isAnimating, setIsAnimating] = useState(true)
  const stripRef = useRef<HTMLDivElement>(null)

  const visible = chips.filter((c) => !dismissed.has(`${c.field}:${c.value}`))
  const showStrip = !isStreaming && visible.length > 0

  const transition = prefersReducedMotion ? REDUCED : SPRING

  // Clear selection when the selected chip is no longer visible
  useEffect(() => {
    if (!selectedKey) return
    const stillVisible = visible.some((c) => `${c.field}:${c.value}` === selectedKey)
    if (!stillVisible) setSelectedKey(null)
  }, [visible, selectedKey])

  // Click outside the strip clears selection
  useEffect(() => {
    if (!selectedKey) return
    const onPointerDown = (e: PointerEvent) => {
      if (!stripRef.current?.contains(e.target as Node)) setSelectedKey(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [selectedKey])

  const handleDelete = () => {
    if (!selectedKey) return
    dismiss(selectedKey)
    setSelectedKey(null)
  }

  useHotkey('delete', handleDelete, {
    enabled: !!selectedKey,
    conflictBehavior: 'allow',
  })
  useHotkey('backspace', handleDelete, {
    enabled: !!selectedKey,
    conflictBehavior: 'allow',
  })

  return (
    <AnimatePresence initial={false}>
      {showStrip && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
          transition={transition}
          onAnimationStart={() => setIsAnimating(true)}
          onAnimationComplete={() => setIsAnimating(false)}
          style={{ overflow: isAnimating ? 'hidden' : 'visible' }}>
          <div ref={stripRef} className='flex flex-wrap gap-1.5  pt-2 pb-1'>
            <AnimatePresence initial={true}>
              {visible.map((chip, i) => {
                const Icon = chip.icon ? ICONS[chip.icon] : Inbox
                const key = `${chip.field}:${chip.value}`
                const selected = selectedKey === key
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
                    role='button'
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`${chip.label ?? chip.value} — press Delete to remove`}
                    onClick={() => setSelectedKey(key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedKey(key)
                      }
                    }}
                    className={cn(
                      recordBadgeVariants({ variant: 'default', size: 'default' }),
                      'cursor-pointer focus-visible:ring-2 focus-visible:ring-info',
                      selected && 'ring-2 ring-info'
                    )}>
                    <Icon className='size-3 shrink-0' />
                    <span data-slot='record-display' className='max-w-[160px] truncate'>
                      {chip.label ?? chip.value}
                    </span>
                    <button
                      type='button'
                      data-slot='record-remove'
                      aria-label='Remove from Kopilot context'
                      onClick={(e) => {
                        e.stopPropagation()
                        dismiss(key)
                        if (selectedKey === key) setSelectedKey(null)
                      }}>
                      <X />
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
