import Link from 'next/link'
import { config } from '@/lib/config'
import { Button } from '~/components/ui/button'
import { ManufacturingHeroIllustration } from './manufacturing-hero-illustration'

export default function ManufacturingHero() {
  return (
    <section className='bg-muted relative border-b'>
      <div className='bg-linear-to-t to-purple-500/7 from-emerald-500/5 pt-20 md:pt-28'>
        <div className='relative z-10 mx-auto max-w-6xl'>
          <div className='relative p-2'>
            <div
              aria-hidden
              className='absolute inset-0 flex items-center justify-between max-md:hidden'>
              <div className='space-y-2 px-12 py-2'>
                <div className='h-2 w-32 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
                <div className='h-2 w-20 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
              </div>
              <div className='space-y-2 px-12 py-2'>
                <div className='h-2 w-32 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
                <div className='ml-auto h-2 w-20 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
              </div>
            </div>

            <div className='mx-auto flex w-fit items-center gap-4'>
              <div aria-hidden className='flex items-center gap-3 max-sm:hidden'>
                <div className='bg-border-illustration h-px w-6' />
                <div className='border-border-illustration size-2 rounded-full border' />

                <div className='ml-auto h-4 w-6 bg-[repeating-linear-gradient(45deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]' />
              </div>
              <div className='after:border-border-illustration before:border-border-illustration bg-foreground/3 relative p-2 before:pointer-events-none before:absolute before:-inset-x-6 before:inset-y-0 before:border-y after:pointer-events-none after:absolute after:-inset-y-3 after:inset-x-0 after:border-x'>
                <div className='ring-border-illustration bg-card/75 relative mx-auto flex h-fit w-fit items-center gap-2 rounded-full px-3 py-1 shadow ring-1'>
                  <span className='text-title text-sm'>Manufacturing & Supply Chain</span>
                  <span className='block h-3 w-px bg-gray-200'></span>
                  <Link href='#' className='text-primary text-sm'>
                    Read
                  </Link>
                </div>
              </div>
              <div aria-hidden className='flex items-center gap-3 max-sm:hidden'>
                <div className='border-border-illustration size-2 rotate-45 border' />
                <div className='ml-auto h-4 w-6 bg-[repeating-linear-gradient(0deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]' />
                <div className='bg-border-illustration h-px w-6' />
              </div>
            </div>
          </div>
          <div className='mt-6 px-6 text-center *:mx-auto md:mt-10 lg:px-12'>
            <h1 className='mb-4 max-w-4xl text-balance text-5xl font-medium lg:text-7xl lg:tracking-tight'>
              <span className='max-sm:hidden'>Smart</span> Manufacturing Parts & Vendor Tracking
            </h1>
            <div className='max-w-2xl'>
              <p className='text-muted-foreground mb-6 text-balance text-lg'>
                Track inventory, manage vendors, and optimize supply chains with real-time
                visibility into your manufacturing operations.
              </p>
              <div className='flex items-center justify-between'>
                <div
                  aria-hidden
                  className='scale-85 flex w-28 flex-wrap justify-end gap-2.5 opacity-75'>
                  {Array.from({ length: 10 }).map((_, index) => (
                    <div key={index} aria-hidden className='h-5 w-2.5 max-sm:last:hidden'>
                      <div className='bg-card rounded-t-xs ring-foreground/5 h-1.5 shadow ring-1' />
                      <div className='bg-foreground/5 border-foreground/10 relative mx-auto h-2 w-2 border-x' />
                      <div className='bg-card rounded-b-xs ring-foreground/5 h-1.5 shadow ring-1' />
                    </div>
                  ))}
                </div>
                <div className='flex flex-wrap justify-center gap-3'>
                  <Button asChild>
                    <Link href={config.urls.signup}>Start Tracking</Link>
                  </Button>
                  <Button asChild variant='outline'>
                    <Link href={config.urls.demo}>View Demo</Link>
                  </Button>
                </div>
                <div aria-hidden className='scale-85 flex w-28 flex-wrap gap-2.5 opacity-75'>
                  {Array.from({ length: 10 }).map((_, index) => (
                    <div key={index} aria-hidden className='h-5 w-2.5 max-sm:last:hidden'>
                      <div className='bg-card rounded-t-xs ring-foreground/5 h-1.5 shadow ring-1' />
                      <div className='bg-foreground/5 border-foreground/10 relative mx-auto h-2 w-2 border-x' />
                      <div className='bg-card rounded-b-xs ring-foreground/5 h-1.5 shadow ring-1' />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <ManufacturingHeroIllustration />
      </div>
    </section>
  )
}
