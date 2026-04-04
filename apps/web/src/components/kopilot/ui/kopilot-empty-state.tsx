// apps/web/src/components/kopilot/ui/kopilot-empty-state.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

const suggestions = [
  'Summarize my open tickets',
  'Draft a reply to the latest email',
  'Find contacts from California',
  'Show me unresolved orders',
  'What tickets came in today?',
]

interface KopilotEmptyStateProps {
  onSuggestionClick?: (text: string) => void
}

export function KopilotEmptyState({ onSuggestionClick }: KopilotEmptyStateProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % suggestions.length)
    }, 2500)
    return () => clearInterval(timer)
  }, [])

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

          {/* <div className='absolute inset-0 z-20 m-auto flex size-10 items-center justify-center rounded-full bg-purple-500/10'>
          <Sparkles className='size-5 text-purple-500' />
        </div> */}
        </div>
        <div className='space-y-1 '>
          <p className='text-sm font-medium'>Kopilot</p>
          <p className='text-xs text-muted-foreground max-w-[200px]'>
            Ask about tickets, contacts, or anything in your inbox.
          </p>
        </div>
      </div>

      {/* Title */}

      {/* Rotating suggestions */}
      <div className='h-8 w-full max-w-xs'>
        <AnimatePresence mode='wait'>
          <motion.button
            type='button'
            key={currentIndex}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className={cn(
              'w-full cursor-pointer rounded-full border px-4 py-1.5 text-xs',
              'text-muted-foreground hover:border-purple-500/40 hover:text-foreground',
              'transition-colors'
            )}
            onClick={() => onSuggestionClick?.(suggestions[currentIndex]!)}>
            {suggestions[currentIndex]}
          </motion.button>
        </AnimatePresence>
      </div>
    </div>
  )
}
