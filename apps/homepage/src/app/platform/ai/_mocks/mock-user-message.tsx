// apps/homepage/src/app/platform/ai/_mocks/mock-user-message.tsx

'use client'

import { motion } from 'motion/react'

/**
 * Visual port of `apps/web/src/components/kopilot/ui/messages/user-message.tsx`.
 * Right-aligned bubble that springs in. Same Tailwind classes as the real one.
 */
export function MockUserMessage({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className='ml-auto flex w-fit max-w-4/5 flex-col items-end'>
      <div className='bg-illustration text-muted-foreground ring-border-illustration shadow-black/6.5 w-fit rounded-l-xl rounded-tr-xl rounded-br px-3 py-2 text-sm/5 shadow ring-1'>
        {text}
      </div>
    </motion.div>
  )
}
