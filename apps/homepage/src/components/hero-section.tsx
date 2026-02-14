'use client'
import { ArrowUp, Globe, Play, Plus, Sparkle } from 'lucide-react'
import { motion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import React from 'react'
import HeroHeader from '@/components/header'
import { Beacon } from '@/components/logos/beacon'
import { Hulu } from '@/components/logos/hulu'
import { Spotify } from '@/components/logos/spotify'
import { Supabase } from '@/components/logos/supabase'
import { Button } from '@/components/ui/button'

export default function HeroSection() {
  const { scrollY } = useScroll()
  const parallaxFactor = 0.25
  const y = useTransform(scrollY, [0, 500], [0, 500 * parallaxFactor], { clamp: false })

  return (
    <>
      <HeroHeader />
      <main role='main' data-theme='dark' className='bg-background overflow-hidden'>
        <section>
          <div className='relative pb-36 pt-24 lg:pt-16'>
            <div className='relative z-10 mx-auto max-w-5xl px-6'>
              <div className='text-center'>
                <h1 className='mx-auto mt-8 max-w-xl text-balance text-4xl font-semibold md:text-5xl'>
                  Powerful Analytics for Smarter Decisions
                </h1>
                <p className='text-muted-foreground mx-auto mb-8 mt-4 max-w-xl text-balance text-lg'>
                  With Tailark's personal AI, get your projects to the finish line faster and with
                  no context switching.
                </p>

                <div className='flex items-center justify-center gap-3 max-sm:flex-col'>
                  <Button asChild>
                    <Link href='#link'>
                      <span className='text-nowrap'>Start Using</span>
                    </Link>
                  </Button>
                  <Button key={2} asChild variant='outline' className='pl-3.5'>
                    <Link href='#link'>
                      <Play className='fill-foreground !size-3' />
                      <span className='text-nowrap'>Watch Video</span>
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
            <div className='relative mt-6 overflow-hidden pb-12 max-md:px-6'>
              <div className='mask-radial-to-65% absolute inset-0 mx-auto lg:w-2/3'>
                <motion.img
                  style={{ y }}
                  className='mx-auto size-full origin-top object-cover mix-blend-multiply'
                  src='https://images.unsplash.com/photo-1653919492307-6191a10280f4?q=80&w=987&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
                  alt='background'
                />
              </div>
              <div
                aria-hidden
                className='bg-background/90 inset-ring-1 inset-ring-background border-foreground/10 m-auto max-w-sm translate-y-12 rounded-2xl border p-6 shadow-xl backdrop-blur-3xl'>
                <div className='flex gap-1'>
                  <div className='bg-foreground/10 size-2 rounded-full' />
                  <div className='bg-foreground/10 size-2 rounded-full' />
                  <div className='bg-foreground/10 size-2 rounded-full' />
                </div>

                <div className='mt-6 text-center'>
                  <div className='flex justify-center gap-1'>
                    <div className='border-background dark:inset-ring dark:inset-ring-white/25 bg-linear-to-b dark:inset-shadow-2xs dark:inset-shadow-white/25 relative flex size-5 items-center justify-center rounded-full border from-purple-300 to-indigo-600 shadow-md shadow-black/20 ring-1 ring-black/10 dark:border-0 dark:shadow-white/10 dark:ring-black/50'>
                      <div className='absolute inset-1 aspect-square rounded-full border border-white/35 bg-black/15'></div>
                      <div className='absolute inset-px aspect-square rounded-full border border-dashed border-white/25'></div>
                      <Sparkle className='size-3 fill-white stroke-white drop-shadow-sm' />
                    </div>
                    <span className='text-[15px] font-medium'>Mist AI</span>
                  </div>
                  <p className='text-foreground/75 mx-auto mt-3 max-w-40 text-balance leading-tight'>
                    Your Personnal AI When it really matters
                  </p>
                  <div className='border-background bg-foreground/10 inline-flex h-0.5 w-20 border-b'></div>
                </div>

                <div className='mb-8 mt-4 space-y-6'>
                  <div className='max-w-3/4 ml-auto w-fit'>
                    <p className='border-foreground/5 bg-foreground/5 mb-2 rounded-l-2xl rounded-t-2xl rounded-br border p-4 text-sm'>
                      Mollitia rerum est quisquam nobis ut cumque, dolore earum a voluptate esse.
                      Illo, rerum esse?
                    </p>
                    <span className='text-muted-foreground block text-right text-xs'>Now</span>
                  </div>
                  <div className='max-w-3/4 w-fit'>
                    <Sparkle className='size-4 fill-white stroke-white drop-shadow-md' />
                    <p className='mt-2 text-sm'>
                      Mollitia rerum est quisquam nobis ut cumque, dolore earum a voluptate esse.
                      Illo, rerum esse?
                    </p>
                  </div>
                </div>

                <div className='bg-foreground/5 -mx-3 -mb-3 space-y-3 rounded-lg p-3'>
                  <div className='text-muted-foreground text-sm'>Ask Anything</div>

                  <div className='flex justify-between'>
                    <div className='flex gap-2'>
                      <Button
                        variant='outline'
                        size='icon'
                        className='size-7 rounded-2xl bg-transparent shadow-none'>
                        <Plus />
                      </Button>
                      <Button
                        variant='outline'
                        size='icon'
                        className='size-7 rounded-2xl bg-transparent shadow-none'>
                        <Globe />
                      </Button>
                    </div>

                    <Button
                      size='icon'
                      className='bg-foreground text-background size-7 rounded-2xl'>
                      <ArrowUp strokeWidth={2} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className='mx-auto mt-8 max-w-5xl px-6 text-center md:mt-16'>
              <p className='text-muted-foreground text-sm'>Trusted by teams at</p>
              <div className='**:fill-foreground mx-auto mt-6 flex w-full max-w-lg flex-wrap items-center justify-center gap-8 *:w-fit lg:justify-between'>
                <Hulu height={20} width='auto' />

                <Spotify height={26} width='auto' />
                <Supabase height={24} width='auto' />
                <Beacon height={20} width='auto' />
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
