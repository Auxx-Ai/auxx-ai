// apps/homepage/src/app/platform/ai/_mocks/mock-kopilot-prompt.tsx

'use client'

import { Check, Send, Sparkles, SquareSlash } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '~/lib/utils'

export interface MockKopilotPromptRow {
  field: string
  value: string
  accept?: boolean
}

interface MockKopilotPromptProps {
  prompt: string
  result: { title: string; rows: MockKopilotPromptRow[] }
  modelLabel?: string
  className?: string
}

const SPRING_BUBBLE = { type: 'spring' as const, stiffness: 400, damping: 25 }
const SPRING_BLUR = { type: 'spring' as const, stiffness: 200, damping: 25 }

/**
 * Compact single-prompt variant of `MockKopilotWindow` — used in the personas
 * tabs. Same animation language as the full window: spring 400/25 for the user
 * bubble, spring 200/25 (with blur) for the result block + rows.
 */
export function MockKopilotPrompt({
  prompt,
  result,
  modelLabel = 'GPT-5.4 Nano',
  className,
}: MockKopilotPromptProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-mock-window-border bg-mock-card text-mock-window-foreground shadow-sm',
        className
      )}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={SPRING_BUBBLE}
        className='border-b border-mock-window-border bg-mock-composer px-4 py-3'>
        <div className='text-xs uppercase tracking-wide text-mock-window-muted'>Prompt</div>
        <div className='mt-0.5 text-sm text-mock-window-foreground'>{prompt}</div>
      </motion.div>

      <motion.ul
        initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
        animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
        transition={{ ...SPRING_BLUR, delay: 0.1 }}
        className='divide-y divide-mock-window-border'>
        <li className='px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-mock-window-muted'>
          {result.title}
        </li>
        {result.rows.map((row, i) => (
          <motion.li
            key={i}
            initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
            animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
            transition={{ ...SPRING_BLUR, delay: 0.18 + i * 0.05 }}
            className='grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-sm'>
            <div className='min-w-0'>
              <div className='text-xs text-mock-window-muted'>{row.field}</div>
              <div className='truncate text-mock-window-foreground'>{row.value}</div>
            </div>
            {row.accept ? (
              <span className='inline-flex items-center gap-1 rounded-md border border-mock-window-border bg-mock-window px-2 py-1 text-xs text-mock-window-foreground'>
                <Check className='size-3' />
                Accept
              </span>
            ) : null}
          </motion.li>
        ))}
      </motion.ul>

      <div className='flex items-center justify-between border-t border-mock-window-border bg-mock-composer px-3 py-2 text-mock-window-muted'>
        <span className='inline-flex items-center gap-1 text-xs'>
          <Sparkles className='size-3 text-amber-500' />
          <span>{modelLabel}</span>
          <span className='rounded-sm bg-mock-bubble px-1 text-[10px]'>×1</span>
        </span>
        <span className='flex items-center gap-1'>
          <SquareSlash className='size-3.5' />
          <Send className='size-3.5' />
        </span>
      </div>
    </div>
  )
}
