import Link from 'next/link'
import React from 'react'
import { config } from '@/lib/config'
import { Button } from '~/components/ui/button'
import { TicketingHeroIllustration } from './ticketing-hero-illustration'

export default function TicketingHero() {
  return (
    <section className='border-b'>
      <div className='bg-muted py-20'>
        <div className='mx-auto max-w-5xl px-6'>
          <div className='grid items-center gap-12 md:grid-cols-2'>
            <div className='max-md:text-center'>
              <span className='text-primary bg-primary/5 border-primary/10 rounded-full border px-2 py-1 text-sm font-medium'>
                Support Ticketing
              </span>
              <h1 className='mt-4 text-balance text-3xl font-semibold md:text-4xl lg:text-5xl'>
                Scale customer happiness with intelligent ticketing
              </h1>
              <p className='text-muted-foreground mb-6 mt-4 max-w-md text-balance text-lg max-md:mx-auto'>
                Manage support requests efficiently without losing the personal connection with
                customers.
              </p>

              <Button asChild>
                <Link href={config.urls.signup}>Start Managing Tickets</Link>
              </Button>
              <Button asChild variant='outline' className='ml-3'>
                <Link href={config.urls.demo}>See Demo</Link>
              </Button>
            </div>

            <TicketingHeroIllustration />
          </div>
        </div>
      </div>
    </section>
  )
}
