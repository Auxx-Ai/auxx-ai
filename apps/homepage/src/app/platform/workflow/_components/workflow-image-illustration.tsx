// apps/web/src/app/(website)/platform/workflow/_components/workflow-image-illustration.tsx
'use client'
import { motion, useScroll, useTransform } from 'motion/react'

const AnimatedGroup = ({ children, variants }: { children: React.ReactNode; variants: any }) => {
  return (
    <motion.div initial='hidden' animate='visible' variants={variants}>
      {children}
    </motion.div>
  )
}

export const ImageIllustration = () => {
  const { scrollY } = useScroll()
  const parallaxFactor = 0.12
  const y = useTransform(scrollY, [0, 500], [0, 500 * parallaxFactor], { clamp: false })
  const maxScale = 1.2
  // const maxSize = 200
  const scale = useTransform(scrollY, [0, 500], [1, maxScale], { clamp: true })
  const rotateX = useTransform(scrollY, [0, 500], [12, 4], { clamp: true })
  // const size = useTransform(scrollY, [0, 300], [1, maxSize], { clamp: true })

  return (
    <motion.div style={{ y, scale, rotateX }} className='relative mx-auto aspect-video max-w-sm'>
      <AnimatedGroup
        variants={{
          container: {
            visible: {
              transition: {
                staggerChildren: 0.2,
                delayChildren: 0,
              },
            },
          },
          item: {
            hidden: {
              opacity: 0,
              filter: 'blur(12px)',
              y: -120,
              rotateX: 56,
              scale: 2,
            },
            visible: {
              opacity: 1,
              filter: 'blur(0px)',
              y: 0,
              scale: 1,
              rotateX: 0,
              transition: {
                type: 'spring',
                bounce: 0.2,
                duration: 2,
              },
            },
          },
        }}>
        <div
          key={2}
          aria-hidden
          className='ring-foreground/15 bg-background absolute inset-0 z-0 aspect-video w-full max-w-sm translate-y-4 scale-95 overflow-hidden rounded-2xl border border-x-0 border-b-4 border-transparent border-b-indigo-950/10 opacity-50 shadow-2xl shadow-indigo-950/20 ring-1'
        />
        <div
          key={1}
          aria-hidden
          className='ring-foreground/15 bg-background z-100 absolute aspect-video w-full max-w-sm overflow-hidden rounded-2xl border border-x-0 border-b-4 border-transparent border-b-indigo-950/10 shadow-2xl shadow-indigo-950/20 ring-1'
        />
        <div
          key={3}
          aria-hidden
          className='mask-radial-from-50% starting:opacity-100 pointer-events-none absolute inset-0 aspect-video -translate-y-full rounded-2xl opacity-50 duration-500'
          style={{
            backgroundImage: `
        repeating-linear-gradient(22.5deg, transparent, transparent 1px, rgba(75, 85, 99, 0.06) 1px, rgba(75, 85, 99, 0.06) 2px, transparent 2px, transparent 4px),
        repeating-linear-gradient(67.5deg, transparent, transparent 1px, rgba(107, 114, 128, 0.05) 1px, rgba(107, 114, 128, 0.05) 2px, transparent 2px, transparent 4px),
        repeating-linear-gradient(112.5deg, transparent, transparent 1px, rgba(55, 65, 81, 0.04) 1px, rgba(55, 65, 81, 0.04) 2px, transparent 2px, transparent 4px),
        repeating-linear-gradient(157.5deg, transparent, transparent 1px, rgba(31, 41, 55, 0.03) 1px, rgba(31, 41, 55, 0.03) 2px, transparent 2px, transparent 4px)
      `,
          }}
        />
        <div
          key={4}
          className='bg-background/5 absolute inset-0 flex aspect-video z-120 flex-col rounded-2xl p-5 text-left ring-1 ring-white/5'>
          {/* Left handle + noodle */}
          <svg
            className='absolute -left-10 top-1/2 -translate-y-1/2 z-200'
            width='40'
            height='40'
            viewBox='0 0 40 40'>
            <path
              d='M0 20 C20 20, 20 20, 40 20'
              stroke='currentColor'
              strokeWidth='1.5'
              fill='none'
              className='text-foreground/20'
            />
            <circle cx='40' cy='20' r='6' className='fill-indigo-500' />
          </svg>

          {/* Right handles + noodles */}
          <svg
            className='absolute -right-12 top-8 bottom-0 z-200'
            width='48'
            height='100%'
            viewBox='0 0 48 180'
            preserveAspectRatio='none'>
            {/* Top noodle — Create */}
            <path
              d='M0 55 C24 55, 24 45, 48 30'
              stroke='currentColor'
              strokeWidth='1.5'
              fill='none'
              className='text-green-500/40'
            />
            <circle cx='0' cy='55' r='6' className='fill-green-500' />
            {/* Middle noodle — Update */}
            <path
              d='M0 90 C24 90, 24 90, 48 90'
              stroke='currentColor'
              strokeWidth='1.5'
              fill='none'
              className='text-blue-500/40'
            />
            <circle cx='0' cy='90' r='6' className='fill-blue-500' />
            {/* Bottom noodle — Fail */}
            <path
              d='M0 125 C24 125, 24 135, 48 150'
              stroke='currentColor'
              strokeWidth='1.5'
              fill='none'
              className='text-red-500/40'
            />
            <circle cx='0' cy='125' r='6' className='fill-red-500' />
          </svg>

          {/* Node Header */}
          <div className='flex items-center gap-3 pb-4'>
            <div className='flex size-10 shrink-0 items-center justify-center rounded-lg border bg-indigo-500/10'>
              <WorkflowIcon />
            </div>
            <span className='font-mono text-lg font-semibold truncate'>Auto Reply</span>
          </div>

          {/* Node Body */}
          <div className='space-y-1'>
            <div className='flex items-center rounded-lg bg-foreground/5 p-1.5'>
              <div className='flex h-6 shrink-0 items-center rounded-md bg-green-500/15 px-2 text-xs font-semibold uppercase text-green-700 dark:text-green-400'>
                Create
              </div>
              <span className='pl-2 text-sm'>Draft Response</span>
            </div>
            <div className='flex items-center rounded-lg bg-foreground/5 p-1.5'>
              <div className='flex h-6 shrink-0 items-center rounded-md bg-blue-500/15 px-2 text-xs font-semibold uppercase text-blue-700 dark:text-blue-400'>
                Update
              </div>
              <span className='pl-2 text-sm'>Ticket Status</span>
            </div>
            <div className='flex items-center rounded-lg bg-foreground/5 p-1.5'>
              <div className='flex h-6 shrink-0 items-center rounded-md bg-red-500/15 px-2 text-xs font-semibold uppercase text-red-700 dark:text-red-400'>
                On Failure
              </div>
              <span className='pl-2 text-sm text-muted-foreground'>Fail Branch</span>
            </div>
          </div>
        </div>
      </AnimatedGroup>
    </motion.div>
  )
}

const WorkflowIcon = () => {
  return (
    <svg
      width='20'
      height='20'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className='text-indigo-500'>
      <path
        d='M12 2L2 7L12 12L22 7L12 2Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M2 17L12 22L22 17'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M2 12L12 17L22 12'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
