'use client'
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
  InstagramFull,
  OpenAIFull,
  OutlookFull,
  QuoFull,
} from '@/components/logos'
import { Beacon } from '~/components/logos/beacon'
import { Cisco } from '~/components/logos/cisco'
import { LeapWallet } from '~/components/logos/leap-wallet'
import { PayPal } from '~/components/logos/paypal'
import { Polars } from '~/components/logos/polars'
import { Stripe } from '~/components/logos/stripe'

const aiLogos: React.ReactNode[] = [
  <OpenAIFull height={24} />,
  <AnthropicFull height={22} />,
  <GeminiFull height={32} />,
  <DeepseekFull height={26} />,
  <GroqFull height={26} />,
]

const messagesLogos: React.ReactNode[] = [
  <Gmail height={24} />,
  <OutlookFull height={24} />,
  <InstagramFull height={20} />,
  <FacebookFull height={20} />,
  <QuoFull height={20} />,
]

const paymentsLogos: React.ReactNode[] = [
  <Stripe height={24} />,
  <PayPal height={24} />,
  <LeapWallet height={24} />,
  <Beacon height={20} />,
  <Polars height={24} />,
]

const streamingLogos: React.ReactNode[] = [<Cisco height={32} />, <Beacon height={20} />]

const logos: Record<'ai' | 'messages' | 'streaming' | 'payments', React.ReactNode[]> = {
  ai: aiLogos,
  messages: messagesLogos,
  payments: paymentsLogos,
  streaming: streamingLogos,
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
    <section className='border-foreground/10 relative  border-b'>
      <div className='mx-auto max-w-6xl border-x px-3'>
        <div className='border-x py-8 md:py-16'>
          <div className='mx-auto mb-12 max-w-xl text-balance text-center md:mb-16'>
            <p data-current={currentGroup} className='text-muted-foreground mt-4 md:text-lg'>
              Auxx.Ai integrates with{' '}
              <span className='in-data-[current=messages]:text-foreground transition-colors duration-200'>
                Email and Messaging apps,
              </span>{' '}
              <span className='in-data-[current=ai]:text-foreground transition-colors duration-200'>
                AI Providers,
              </span>{' '}
              <span className='in-data-[current=payments]:text-foreground transition-colors duration-200'>
                Payments Providers,
              </span>{' '}
              <span className='in-data-[current=streaming]:text-foreground transition-colors duration-200'>
                Streaming Providers
              </span>
            </p>
          </div>
          <div className='perspective-dramatic mx-auto grid max-w-5xl grid-cols-3 items-center gap-8 md:h-10 md:grid-cols-5'>
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
    </section>
  )
}
