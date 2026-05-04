// apps/web/src/components/kopilot/ui/kopilot-empty-state.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  FileText,
  History,
  List,
  Mail,
  Mic,
  Pencil,
  Plus,
  Reply,
  Search,
  ShoppingBag,
  Sparkles,
  User,
  Workflow,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { useKopilotSuggestions } from '../stores/select-suggestions'
import type { SuggestionIcon, SuggestionSlice } from '../suggestions/types'

const ICONS: Record<SuggestionIcon, typeof Sparkles> = {
  mail: Mail,
  user: User,
  file: FileText,
  mic: Mic,
  sparkle: Sparkles,
  reply: Reply,
  list: List,
  plus: Plus,
  history: History,
  'shopping-bag': ShoppingBag,
  workflow: Workflow,
  pencil: Pencil,
  search: Search,
}

const SPRING = { type: 'spring', stiffness: 220, damping: 26 } as const

const FALLBACK: SuggestionSlice[] = [
  { id: '__fallback_open', text: 'Summarize my open tickets', priority: 0, autoSubmit: true },
  {
    id: '__fallback_today',
    text: 'What tickets came in today?',
    priority: 0,
    autoSubmit: true,
  },
  {
    id: '__fallback_unresolved',
    text: 'Show me unresolved orders',
    priority: 0,
    autoSubmit: true,
  },
  {
    id: '__fallback_contacts',
    text: 'Find contacts from California',
    priority: 0,
    autoSubmit: true,
  },
  {
    id: '__fallback_draft',
    text: 'Draft a reply to the latest email',
    priority: 0,
    autoSubmit: true,
  },
]

interface KopilotEmptyStateProps {
  onSuggestionClick?: (text: string, autoSubmit: boolean) => void
}

export function KopilotEmptyState({ onSuggestionClick }: KopilotEmptyStateProps) {
  const registered = useKopilotSuggestions()
  const prefersReducedMotion = useReducedMotion()

  // All-or-nothing: page-registered suggestions take over completely. The
  // fallback list is only rendered when no surface contributed anything.
  const visible = useMemo(() => (registered.length > 0 ? registered : FALLBACK), [registered])

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center'>
      {/* Animated sparkle orb */}
      <div aria-hidden className='relative flex items-center justify-center flex-col space-y-10'>
        <div className='relative size-28'>
          {/* Grid overlay — light */}
          <div
            className='absolute -inset-4 z-10 opacity-20 dark:hidden'
            style={{
              maskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 70%, transparent 100%)',
              backgroundImage:
                'linear-gradient(to right, rgba(0,0,0,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.4) 1px, transparent 1px)',
              backgroundSize: '5px 5px',
            }}
          />
          {/* Grid overlay — dark */}
          <div
            className='absolute -inset-4 z-10 hidden opacity-15 dark:block'
            style={{
              maskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 70%, transparent 100%)',
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.2) 1px, transparent 1px)',
              backgroundSize: '5px 5px',
            }}
          />

          <div className='absolute -inset-3 animate-spin opacity-60 blur-lg duration-[3s] dark:opacity-30'>
            <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-0 rounded-full from-pink-300 to-indigo-300' />
          </div>

          <div className='animate-scan absolute -inset-x-2 inset-y-0 z-10'>
            <div className='absolute inset-x-0 m-auto h-6 rounded-full bg-white/50 blur-2xl' />
          </div>
        </div>
        <div className='space-y-1'>
          <p className='text-sm font-medium'>Kopilot</p>
          <p className='text-xs text-muted-foreground max-w-[200px]'>
            Ask about tickets, contacts, or anything in your inbox.
          </p>
        </div>
      </div>

      {/* Suggestions column */}
      <div className='flex w-full max-w-xs flex-col gap-1'>
        <AnimatePresence initial={true}>
          {visible.map((s, i) => {
            const Icon = s.icon ? ICONS[s.icon] : Sparkles
            return (
              <motion.button
                type='button'
                key={s.id}
                layout
                initial={
                  prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(3px)' }
                }
                animate={
                  prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }
                }
                exit={
                  prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(3px)' }
                }
                transition={
                  prefersReducedMotion ? { duration: 0.12 } : { ...SPRING, delay: i * 0.04 }
                }
                onClick={() => onSuggestionClick?.(s.text, s.autoSubmit)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border bg-background',
                  'px-3 py-2 text-left text-xs text-muted-foreground',
                  'hover:border-purple-500/40 hover:text-foreground',
                  'transition-colors cursor-pointer'
                )}>
                <Icon className='size-3.5 shrink-0' />
                <span className='flex-1 truncate'>{s.text}</span>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
