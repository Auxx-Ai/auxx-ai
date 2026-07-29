// apps/homepage/src/app/platform/sequences/_components/personalization-section.tsx
'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { cn } from '~/lib/utils'
import { MockStepEditor, type StepEditorVariant } from '../_mocks'

const items: {
  key: StepEditorVariant
  title: string
  description: string
}[] = [
  {
    key: 'placeholders',
    title: 'Fields drop straight in',
    description:
      'First name, invoice number, job title, due date — pulled from the record at send time, with a fallback for when a field is empty.',
  },
  {
    key: 'snippets',
    title: 'Snippets and attachments',
    description:
      'Insert a saved snippet, attach the quote or the service report. Set per step, so the right file rides along with the right email.',
  },
  {
    key: 'sender',
    title: 'Your mailbox, your signature',
    description:
      'Sends from a mailbox you pin, with a signature that mailbox is allowed to use. Replies land in your inbox, not a void.',
  },
]

/**
 * Sticky copy on the left, a slice of the real step editor on the right that
 * swaps with the selected item.
 */
export default function PersonalizationSection() {
  const [active, setActive] = useState<StepEditorVariant>('placeholders')

  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='grid gap-12 lg:grid-cols-2 lg:gap-16'>
          <div className='lg:sticky lg:top-32 lg:self-start'>
            <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
              It reads like you wrote it.
              <span className='text-muted-foreground'> Because you did — once.</span>
            </h2>

            <div className='mt-10 space-y-1'>
              {items.map((item) => {
                const isActive = item.key === active
                return (
                  <button
                    key={item.key}
                    type='button'
                    onClick={() => setActive(item.key)}
                    className='block w-full border-t py-4 text-left'>
                    <div
                      className={cn(
                        'font-medium transition-colors',
                        isActive ? 'text-foreground' : 'text-muted-foreground'
                      )}>
                      {item.title}
                    </div>
                    <AnimatePresence initial={false}>
                      {isActive && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.25 }}
                          className='overflow-hidden text-sm text-muted-foreground'>
                          <span className='block pt-2'>{item.description}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </button>
                )
              })}
              <div className='border-t' />
            </div>
          </div>

          <div className='relative flex min-h-[380px] items-center'>
            <div
              aria-hidden
              className='pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle,var(--color-foreground)_1px,transparent_1px)] [background-size:20px_20px] opacity-[0.07] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]'
            />
            <div className='relative w-full'>
              <AnimatePresence mode='wait'>
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0)' }}
                  exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }}
                  transition={{ duration: 0.3 }}>
                  <MockStepEditor variant={active} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
