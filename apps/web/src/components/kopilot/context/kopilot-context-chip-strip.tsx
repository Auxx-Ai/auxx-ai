// apps/web/src/components/kopilot/context/kopilot-context-chip-strip.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  Book,
  Bot,
  Building2,
  FileText,
  Inbox,
  Mail,
  Table2,
  User,
  Workflow,
  X,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { useKopilotStore } from '../stores/kopilot-store'
import { useKopilotSurfaceRefs } from '../stores/select-context'
import type { SessionRef, SessionRefKind } from './types'

const KIND_ICONS: Record<SessionRefKind, typeof Mail> = {
  thread: Mail,
  record: FileText,
  // An entity TYPE (the records table the user is on), not one row on it.
  resource: Table2,
  kb: Book,
  article: FileText,
  actor: User,
  agent: Bot,
  workflow: Workflow,
}

/**
 * Shown when a ref carries no `label`. A raw id is never a useful chip — it is
 * what the TOOLS resolve against, not something a reader can act on — and
 * surfaces routinely register the id before the query supplying the name has
 * resolved (the workflow builder registers its ref from the route param).
 */
const KIND_FALLBACK_LABELS: Record<SessionRefKind, string> = {
  thread: 'Thread',
  record: 'Record',
  resource: 'Table',
  kb: 'Knowledge base',
  article: 'Article',
  actor: 'User',
  agent: 'Agent',
  workflow: 'Workflow',
}

const SPRING = { type: 'spring', stiffness: 220, damping: 26 } as const
const REDUCED = { duration: 0.12 } as const

/**
 * Chip strip rendered above the composer input. Hides while Kopilot is
 * "thinking..." (the status bar takes that visual space). Each chip is the
 * UI representation of a registered surface `SessionRef`; clicking the X (or
 * selecting and pressing Delete/Backspace) dismisses it for the next turn
 * only. Mention refs live inline in the editor as TipTap badges; they don't
 * appear here.
 */
export function KopilotContextChipStrip() {
  const refs = useKopilotSurfaceRefs()
  const dismissed = useKopilotStore((s) => s.dismissedChipKeys)
  const dismiss = useKopilotStore((s) => s.dismissChip)
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const prefersReducedMotion = useReducedMotion()

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [isAnimating, setIsAnimating] = useState(true)
  const stripRef = useRef<HTMLDivElement>(null)

  // Pinned refs always render — `dismissed` is ignored for them, so a
  // stale dismissal from a prior session can't hide the agent chip.
  const visible = refs.filter((r) => r.pinned || !dismissed.has(refKey(r)))
  const showStrip = !isStreaming && visible.length > 0

  const transition = prefersReducedMotion ? REDUCED : SPRING

  // Clear selection when the selected chip is no longer visible
  useEffect(() => {
    if (!selectedKey) return
    const stillVisible = visible.some((r) => refKey(r) === selectedKey)
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
    const target = visible.find((r) => refKey(r) === selectedKey)
    if (target?.pinned) return
    dismiss(selectedKey)
    setSelectedKey(null)
  }

  useHotkey('Delete', handleDelete, {
    enabled: !!selectedKey,
    conflictBehavior: 'allow',
  })
  useHotkey('Backspace', handleDelete, {
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
              {visible.map((ref, i) => {
                const Icon = pickIcon(ref)
                const key = refKey(ref)
                const display = refLabel(ref)
                const isPinned = !!ref.pinned
                const selected = !isPinned && selectedKey === key
                const chipTransition = prefersReducedMotion
                  ? REDUCED
                  : { ...SPRING, delay: i * 0.04 }
                const interactionProps = isPinned
                  ? {
                      'aria-label': display,
                    }
                  : {
                      role: 'button' as const,
                      tabIndex: 0,
                      'aria-pressed': selected,
                      'aria-label': `${display} — press Delete to remove`,
                      onClick: () => setSelectedKey(key),
                      onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedKey(key)
                        }
                      },
                    }
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
                    {...interactionProps}
                    className={cn(
                      recordBadgeVariants({ variant: 'default', size: 'default' }),
                      !isPinned && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-info',
                      selected && 'ring-2 ring-info'
                    )}>
                    <Icon className='size-3 shrink-0' />
                    <span data-slot='record-display' className='max-w-[160px] truncate'>
                      {display}
                    </span>
                    {!isPinned && (
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
                    )}
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

function refKey(r: SessionRef): string {
  return `${r.kind}:${r.id}`
}

/** Chip text — the ref's own label, else its kind. Never the raw id. */
function refLabel(r: SessionRef): string {
  return r.label ?? KIND_FALLBACK_LABELS[r.kind] ?? 'Reference'
}

/**
 * Refine the icon for `record` chips by id prefix — contacts get a user
 * icon, companies a building icon, anything else falls back to the file
 * icon. Other kinds use the static kind→icon map.
 */
function pickIcon(ref: SessionRef): typeof Mail {
  if (ref.kind === 'record') {
    if (ref.id.startsWith('contact:')) return User
    if (ref.id.startsWith('company:') || ref.id.startsWith('companies:')) return Building2
  }
  return KIND_ICONS[ref.kind] ?? Inbox
}
