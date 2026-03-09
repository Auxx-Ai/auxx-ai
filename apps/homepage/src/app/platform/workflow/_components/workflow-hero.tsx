// apps/web/src/app/(website)/platform/workflow/_components/workflow-hero.tsx
'use client'
import { motion } from 'motion/react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { ImageIllustration } from './workflow-image-illustration'

const AnimatedGroup = ({ children, variants }: { children: React.ReactNode; variants: any }) => {
  return (
    <motion.div initial='hidden' animate='visible' variants={variants}>
      {children}
    </motion.div>
  )
}

export default function WorkflowHero() {
  return (
    <main role='main' className='overflow-hidden'>
      <section className='bg-muted relative [--color-foreground:var(--color-indigo-950)]'>
        <div className='bg-linear-to-b from-background to-indigo-500/6 pb-20 pt-24 md:pt-32 lg:pb-72 lg:pt-36'>
          <div className='perspective-near relative z-10 mx-auto max-w-5xl px-6 text-center'>
            <ImageIllustration />
            <AnimatedGroup
              variants={{
                container: {
                  visible: {
                    transition: {
                      staggerChildren: 0.25,
                      delayChildren: 0,
                    },
                  },
                },
                item: {
                  hidden: {
                    opacity: 0,
                    filter: 'blur(12px)',
                    y: -16,
                  },
                  visible: {
                    opacity: 1,
                    filter: 'blur(0px)',
                    y: 0,
                    rotateX: 0,
                    transition: {
                      type: 'spring',
                      bounce: 0.3,
                      duration: 1,
                    },
                  },
                },
              }}>
              <h1
                key={1}
                className='text-foreground dark:text-indigo-300 mx-auto mt-16 text-balance text-5xl font-semibold'>
                The{' '}
                <span className='bg-linear-to-b from-purple-400 to-indigo-500 bg-clip-text text-transparent'>
                  Workflow Engine
                </span>{' '}
                powering automation on your platform
              </h1>

              <div key={2} className='mx-auto mt-4 max-w-md'>
                <p className='text-muted-foreground mb-6 text-balance text-lg'>
                  Build powerful workflows that run your business while you sleep. Set up in
                  minutes.
                </p>

                <Button asChild className='rounded-full'>
                  <Link href={config.urls.signup}>Get Started for free</Link>
                </Button>
              </div>
            </AnimatedGroup>
          </div>
        </div>
      </section>
    </main>
  )
}
