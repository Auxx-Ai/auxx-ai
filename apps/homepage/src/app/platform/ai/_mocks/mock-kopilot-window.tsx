// apps/homepage/src/app/platform/ai/_mocks/mock-kopilot-window.tsx

'use client'

import {
  ChevronRight,
  CornerDownLeft,
  PanelLeft,
  Plus,
  Send,
  Sparkles,
  SquareSlash,
} from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '~/lib/utils'

export type Turn =
  | { kind: 'user'; text: string }
  | {
      kind: 'tool'
      title: string
      count?: number
      headerLabel?: string
      items: Array<{ code: string; title: string; subtitle: string }>
    }
  | { kind: 'assistant'; text: string }

interface MockKopilotWindowProps {
  breadcrumb?: { trail: string[]; title: string }
  turns?: Turn[]
  composerPlaceholder?: string
  modelLabel?: string
  status?: 'idle' | 'thinking'
  className?: string
}

const SPRING_BUBBLE = { type: 'spring' as const, stiffness: 400, damping: 25 }
const SPRING_BLUR = { type: 'spring' as const, stiffness: 200, damping: 25 }

/**
 * Static facsimile of the Kopilot chat surface
 * (`apps/web/src/components/kopilot/ui/kopilot-page-shell.tsx`).
 *
 * Animations mirror the real components:
 * - User bubble: `kopilot-message-list.tsx` spring 400/25 (opacity + scale + y)
 * - Tool block + rows: `messages/thinking-steps.tsx` spring 200/25 (blur + opacity + y)
 * - "Actioning…" dot: `animate-dot-blink` keyframe defined in globals.css
 */
export function MockKopilotWindow({
  breadcrumb,
  turns = [],
  composerPlaceholder = 'Ask Kopilot...',
  modelLabel = 'GPT-5.4 Nano',
  status = 'idle',
  className,
}: MockKopilotWindowProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[480px] flex-1 flex-col text-mock-window-foreground',
        className
      )}>
      <Header breadcrumb={breadcrumb} />

      <div className='flex-1 overflow-hidden px-6 py-6'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-4'>
          {turns.map((turn, index) => (
            <TurnRenderer key={index} turn={turn} index={index} />
          ))}

          {status === 'thinking' ? <ActioningPill /> : null}
        </div>
      </div>

      <div className='border-t border-mock-window-border px-6 py-3'>
        <div className='mx-auto w-full max-w-2xl'>
          <Composer placeholder={composerPlaceholder} modelLabel={modelLabel} />
        </div>
      </div>
    </div>
  )
}

function Header({ breadcrumb }: { breadcrumb?: MockKopilotWindowProps['breadcrumb'] }) {
  return (
    <div className='flex items-center justify-between border-b border-mock-window-border px-4 py-2 text-xs'>
      <div className='flex items-center gap-2 text-mock-window-muted'>
        <PanelLeft className='size-3.5' />
        {breadcrumb?.trail.map((label) => (
          <span key={label} className='flex items-center gap-2'>
            <span>{label}</span>
            <ChevronRight className='size-3 text-mock-window-muted' />
          </span>
        ))}
        {breadcrumb?.title ? (
          <span className='max-w-[28ch] truncate text-mock-window-foreground'>
            {breadcrumb.title}
          </span>
        ) : null}
      </div>
      <div className='inline-flex items-center gap-1 rounded-md border border-mock-window-border px-2 py-1 text-mock-window-foreground'>
        <Plus className='size-3' />
        <span>New chat</span>
      </div>
    </div>
  )
}

function TurnRenderer({ turn, index }: { turn: Turn; index: number }) {
  const delay = index * 0.08

  if (turn.kind === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ ...SPRING_BUBBLE, delay }}
        className='ml-auto w-fit max-w-md rounded-2xl rounded-tr-sm bg-mock-bubble px-3 py-2 text-sm text-mock-window-foreground'>
        {turn.text}
      </motion.div>
    )
  }

  if (turn.kind === 'assistant') {
    return (
      <motion.div
        initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
        animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
        transition={{ ...SPRING_BLUR, delay }}
        className='max-w-md text-sm text-mock-window-foreground'>
        {turn.text}
      </motion.div>
    )
  }

  return <ToolBlock turn={turn} delay={delay} />
}

function ToolBlock({ turn, delay }: { turn: Extract<Turn, { kind: 'tool' }>; delay: number }) {
  const headerLabel = turn.headerLabel ?? '3 steps completed'

  return (
    <motion.div
      initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
      animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
      transition={{ ...SPRING_BLUR, delay }}
      className='space-y-2'>
      <div className='flex items-center gap-1.5 px-1 text-xs text-mock-window-muted'>
        <Sparkles className='size-3 text-amber-500' />
        <span>{headerLabel}</span>
        <ChevronRight className='size-3' />
      </div>

      <div className='overflow-hidden rounded-xl border border-mock-window-border bg-mock-card'>
        <div className='flex items-center gap-2 border-b border-mock-window-border px-3 py-2 text-xs'>
          <span className='size-1.5 rounded-full bg-mock-window-foreground/40' />
          <span className='font-medium text-mock-window-foreground'>{turn.title}</span>
          {typeof turn.count === 'number' ? (
            <span className='ml-auto rounded-md bg-mock-bubble px-1.5 py-0.5 text-[10px] text-mock-window-muted'>
              {turn.count}
            </span>
          ) : null}
        </div>
        <ul className='divide-y divide-mock-window-border'>
          {turn.items.map((item, i) => (
            <motion.li
              key={i}
              initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
              animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
              transition={{ ...SPRING_BLUR, delay: delay + 0.1 + i * 0.05 }}
              className='flex items-center gap-3 px-3 py-2'>
              <span className='flex size-7 shrink-0 items-center justify-center rounded-md bg-mock-bubble text-[10px] font-medium text-mock-window-muted'>
                {item.code}
              </span>
              <div className='flex min-w-0 flex-col text-xs'>
                <span className='truncate text-mock-window-foreground'>{item.title}</span>
                <span className='truncate text-mock-window-muted'>{item.subtitle}</span>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </motion.div>
  )
}

function ActioningPill() {
  return (
    <div className='flex items-center gap-1 px-1 text-xs text-mock-window-muted'>
      <span>Actioning</span>
      <span className='animate-dot-blink' style={{ animationDelay: '0s' }}>
        .
      </span>
      <span className='animate-dot-blink' style={{ animationDelay: '0.2s' }}>
        .
      </span>
      <span className='animate-dot-blink' style={{ animationDelay: '0.4s' }}>
        .
      </span>
    </div>
  )
}

function Composer({ placeholder, modelLabel }: { placeholder: string; modelLabel: string }) {
  return (
    <div className='relative flex min-h-[100px] flex-row items-end rounded-xl border border-mock-composer-border bg-mock-composer'>
      <div className='flex flex-1 flex-col self-stretch px-3 py-2'>
        <p className='text-sm text-mock-window-muted'>{placeholder}</p>
      </div>
      <div className='absolute bottom-1 left-1'>
        <span className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-mock-window-muted'>
          <Sparkles className='size-3 text-amber-500' />
          <span>{modelLabel}</span>
          <span className='rounded-sm bg-mock-bubble px-1 text-[10px]'>×1</span>
        </span>
      </div>
      <div className='absolute bottom-1 right-1 flex items-center gap-0.5 text-mock-window-muted'>
        <span className='flex size-7 items-center justify-center rounded-md'>
          <SquareSlash className='size-3.5' />
        </span>
        <span className='flex size-7 items-center justify-center rounded-md'>
          <Send className='size-3.5' />
        </span>
        <span className='ml-1 hidden items-center gap-1 text-[10px] sm:inline-flex'>
          <CornerDownLeft className='size-3' />
        </span>
      </div>
    </div>
  )
}
