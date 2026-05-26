// apps/homepage/src/app/_components/sections/hero-section-v2.tsx
'use client'

import { Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { useConfig } from '~/lib/config-context'
import { HeroIllustration } from './hero-illustration'
import { CyclingPill } from './hero-v2/cycling-pill'
import { KopilotMock } from './hero-v2/kopilot-mock'

export default function HeroSectionV2() {
  const { urls } = useConfig()
  const reduce = useReducedMotion()

  return (
    <main role='main' className='relative min-h-screen overflow-hidden bg-muted/30'>
      {/* Soft brand glow behind the mock */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute right-[-10%] top-[-10%] h-[700px] w-[700px] rounded-full bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/5 blur-3xl'
      />

      <section className='relative mx-auto flex min-h-screen max-w-7xl items-center px-6 pt-24 pb-16 lg:pt-28'>
        <div className='grid w-full grid-cols-1 gap-16 lg:grid-cols-12 lg:gap-8'>
          {/* Left column — copy */}
          <div className='flex flex-col items-start justify-center lg:col-span-5 lg:pt-12 z-20'>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className='mb-6 flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/20'>
              <Sparkles className='size-4' />
            </motion.div>

            <motion.h1
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}
              className='text-balance text-4xl font-semibold tracking-tight text-foreground lg:text-5xl backdrop-blur-xs rounded-xl'>
              The AI agent that runs your inbox and CRM.
            </motion.h1>

            <motion.p
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.12 }}
              className='mt-5 max-w-md text-lg leading-relaxed text-muted-foreground backdrop-blur-xs rounded-xl'>
              Kopilot reads every ticket, drafts the reply, and updates your customer record — so
              you sell, and the agent does the rest.
            </motion.p>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.2 }}
              className='mt-8 flex flex-col gap-3 sm:flex-row sm:items-center'>
              <Button asChild className='rounded-full px-6 text-base'>
                <Link href={urls.signup}>Start free trial</Link>
              </Button>
              <Button asChild variant='outline' className='rounded-full px-6 text-base'>
                <Link href={urls.demo}>Try demo</Link>
              </Button>
            </motion.div>
          </div>

          {/* Right column — Kopilot mockup. Hidden below md; the tilted desktop
              mock doesn't translate well to phone widths. */}
          <div className='relative hidden md:block lg:col-span-7'>
            <KopilotMock />
          </div>
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut', delay: 0.3 }}
          className='absolute inset-x-0 bottom-8 z-20 flex justify-start px-6'>
          <CyclingPill />
        </motion.div>
      </section>
      <HeroIllustration />
    </main>
  )
}
