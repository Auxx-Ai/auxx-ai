'use client'
import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import { useEffect, useState } from 'react'
import {
  AnthropicFull,
  DeepseekFull,
  FacebookFull,
  GeminiFull,
  Gmail,
  GroqFull,
  InstagramMono,
  OpenAIFull,
  OutlookFull,
  QuoFull,
} from '@/components/logos'

const logoClass = 'h-7 w-auto'

const aiLogos: React.ReactNode[] = [
  <OpenAIFull className={logoClass} />,
  <AnthropicFull className={logoClass} />,
  <GeminiFull className={logoClass} />,
  <DeepseekFull className={logoClass} />,
  <GroqFull className={logoClass} />,
]

const messagesLogos: React.ReactNode[] = [
  <Gmail className={logoClass} />,
  <OutlookFull className={logoClass} />,
  <InstagramMono className={logoClass} />,
  <FacebookFull className={logoClass} />,
  <QuoFull className={logoClass} />,
]

const logos: Record<'ai' | 'messages', React.ReactNode[]> = {
  ai: aiLogos,
  messages: messagesLogos,
}

type LogoGroup = keyof typeof logos

export default function LogoCloudTwo() {
  const [currentGroup, setCurrentGroup] = useState<LogoGroup>('ai')

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentGroup((prev) => {
        const groups = Object.keys(logos) as LogoGroup[]
        const currentIndex = groups.indexOf(prev)
        const nextIndex = (currentIndex + 1) % groups.length
        return groups[nextIndex]
      })
    }, 2500)

    return () => clearInterval(interval)
  }, [])

  return (
    <section className='border-foreground/10 relative overflow-hidden border-b'>
      <RandomGradient colors={[...GRADIENT_PALETTES.aurora]} mode='mesh' animated />
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3 bg-background/40'>
        <div className='bg-background/40'>
          <div className=' py-8 md:py-16'>
            <div className='mx-auto mb-12 max-w-xl text-balance text-center md:mb-16'>
              <p data-current={currentGroup} className='text-muted-foreground mt-4 md:text-lg'>
                Auxx.Ai integrates with{' '}
                <span className='in-data-[current=messages]:text-foreground transition-colors duration-200'>
                  Email and Messaging apps
                </span>{' '}
                and{' '}
                <span className='in-data-[current=ai]:text-foreground transition-colors duration-200'>
                  AI Providers
                </span>
              </p>
            </div>
            <div
              aria-hidden='true'
              className='perspective-dramatic mx-auto grid max-w-5xl grid-cols-3 items-center gap-8 md:h-10 md:grid-cols-5'>
              <AnimatePresence initial={false} mode='popLayout'>
                {logos[currentGroup].map((logo, i) => (
                  <motion.div
                    key={`${currentGroup}-${i}`}
                    className='**:fill-foreground! flex items-center justify-center'
                    initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -24, filter: 'blur(6px)', scale: 0.5 }}
                    transition={{ delay: i * 0.05, duration: 0.4 }}>
                    {logo}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
