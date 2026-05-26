// apps/homepage/src/app/_components/sections/hero-v2/cycling-pill.tsx
'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

const messages = [
  { label: 'Kopilot', body: 'the agent that runs your inbox' },
  { label: 'Workflows', body: 'automate every repeatable reply' },
  { label: 'Shared inbox', body: 'one place for every customer thread' },
]

const ROTATE_MS = 3500

export function CyclingPill() {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduce || paused) return
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % messages.length)
    }, ROTATE_MS)
    return () => window.clearInterval(id)
  }, [reduce, paused])

  const current = messages[index]

  return (
    <div
      className='inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/70 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur'
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}>
      <span className='relative flex size-1.5'>
        <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75' />
        <span className='relative inline-flex size-1.5 rounded-full bg-primary' />
      </span>
      <AnimatePresence mode='wait' initial={false}>
        <motion.span
          key={current.label}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className='flex items-center gap-1.5'>
          <span className='font-medium text-foreground'>{current.label}</span>
          <span className='text-muted-foreground'>— {current.body}</span>
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
