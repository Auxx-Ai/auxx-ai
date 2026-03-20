// apps/web/src/app/(website)/solutions/customer-support-teams/_components/business-hero.tsx

import Link from 'next/link'
import { config } from '@/lib/config'
import { Button } from '~/components/ui/button'
import { BusinessHeroIllustration } from './business-hero-illustration'

export default function HeroSection() {
  return (
    <section className='border-b'>
      <div className='bg-muted py-20'>
        <div className='mx-auto max-w-5xl px-6'>
          <div className='grid items-center gap-12 md:grid-cols-2'>
            <div className='max-md:text-center'>
              <span className='text-primary text-sm font-medium'>Small Business Solution</span>
              <h1 className='mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl'>
                AI-Powered Customer Support for Small Businesses
              </h1>
              <p className='text-muted-foreground mb-6 mt-4 max-w-md text-balance text-lg max-md:mx-auto'>
                Transform your small business customer service with intelligent AI that handles
                inquiries, manages requests, and delights customers 24/7.
              </p>

              <Button asChild>
                <Link href={config.urls.signup}>Start Free Trial</Link>
              </Button>
              <Button asChild variant='outline' className='ml-3'>
                <Link href={config.urls.demo}>Try Demo</Link>
              </Button>

              <div className='mt-12 grid max-w-sm grid-cols-2 max-md:mx-auto'>
                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    85 <span className='text-muted-foreground text-lg'>%</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Support automation</strong> for
                    common business inquiries.
                  </p>
                </div>

                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    3 <span className='text-muted-foreground text-lg'>X</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Faster responses</strong> with
                    instant data access.
                  </p>
                </div>
              </div>
            </div>

            <BusinessHeroIllustration />
          </div>
        </div>
      </div>
    </section>
  )
}
