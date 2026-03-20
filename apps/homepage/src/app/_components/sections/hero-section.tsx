// apps/homepage/src/app/_components/sections/hero-section.tsx
'use client'

import { Check, Clock, Zap } from 'lucide-react'
import Link from 'next/link'
import MessagingFeatures from '@/app/platform/messaging/_components/messaging-features'
import { Button } from '~/components/ui/button'
import { useConfig } from '~/lib/config-context'

function SocialProofBanner() {
  return (
    <div className='mt-16 flex flex-wrap justify-center items-center gap-8 text-sm font-medium'>
      <div className='flex flex-col items-center'>
        <span className='text-3xl font-bold text-foreground'>500+</span>
        <span className='text-muted-foreground'>Shopify stores</span>
      </div>
      <div className='w-px h-12 bg-border hidden sm:block' />
      <div className='flex flex-col items-center'>
        <span className='text-3xl font-bold text-foreground'>1M+</span>
        <span className='text-muted-foreground'>Tickets resolved</span>
      </div>
      <div className='w-px h-12 bg-border hidden sm:block' />
      <div className='flex flex-col items-center'>
        <span className='text-3xl font-bold text-foreground'>4.9/5</span>
        <span className='text-muted-foreground'>Customer satisfaction</span>
      </div>
    </div>
  )
}

export default function HeroSection() {
  const { urls } = useConfig()

  return (
    <main role='main' className='bg-muted/50'>
      <section id='home' className='relative mx-auto max-w-6xl px-6 pt-32 text-center pb-20'>
        <div className='relative mx-auto max-w-4xl text-center'>
          <h1 className='text-foreground text-balance text-3xl font-semibold sm:mt-12 sm:text-5xl lg:text-5xl'>
            The{' '}
            <span className='italic bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent'>
              AI
            </span>{' '}
            CRM That Runs Itself
          </h1>
          <p className='text-muted-foreground mb-8 mt-6 text-balance text-xl max-w-2xl mx-auto'>
            Open-source support and workflow automation for small businesses
          </p>

          <div className='relative flex flex-col sm:flex-row gap-4 justify-center items-center'>
            <div
              aria-hidden='true'
              className='pointer-events-none absolute inset-x-0 -top-8 mx-auto h-40 max-w-2xl rounded-full bg-gradient-to-b from-blue-500/10 via-purple-500/10 to-pink-500/10 blur-3xl'
            />
            <Button asChild className='px-8 text-base rounded-full'>
              <Link href={urls.signup}>Start 14-Day Free Trial</Link>
            </Button>
            <Button asChild variant='outline' className='px-8 text-base rounded-full'>
              <Link href={urls.demo}>Try Live Demo</Link>
            </Button>
          </div>

          <div className='flex flex-col sm:flex-row gap-4 sm:gap-6 justify-center items-center mt-6 text-sm text-muted-foreground'>
            <span className='flex items-center gap-2'>
              <Check className='h-4 w-4 text-green-500' />
              No credit card required
            </span>
            <span className='flex items-center gap-2'>
              <Clock className='h-4 w-4 text-blue-500' />
              5-minute setup
            </span>
            <span className='flex items-center gap-2'>
              <Zap className='h-4 w-4 text-purple-500' />
              Works with Gmail & Outlook
            </span>
          </div>

          <p className='mt-4 text-xs text-muted-foreground'>
            By signing up, you agree to our{' '}
            <Link href='/terms-of-service' className='underline hover:text-foreground'>
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href='https://auxx.ai/privacy-policy' className='underline hover:text-foreground'>
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {/* <SocialProofBanner /> */}
      </section>
      <MessagingFeatures />
    </main>
  )
}
