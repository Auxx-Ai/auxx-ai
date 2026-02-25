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
          className='bg-background/5 absolute inset-0 flex aspect-video z-120 flex-col justify-between rounded-2xl px-6 py-6 text-left ring-1 ring-white/5'>
          <div className='flex justify-between'>
            <WorkflowIcon />
            <AutomationBadge />
          </div>

          <div className='flex justify-between'>
            <div className='space-y-0.5 *:block'>
              <span className='text-muted-foreground text-xs'>Workflow Status</span>
              <span className='font-mono text-sm font-medium'>Running</span>
            </div>
            <div className='space-y-0.5 *:block'>
              <span className='text-muted-foreground text-xs'>Tasks</span>
              <span className='font-mono text-sm font-medium'>24/30</span>
            </div>
          </div>
        </div>
      </AnimatedGroup>
    </motion.div>
  )
}

const WorkflowIcon = () => {
  return (
    <svg width='26' height='22' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
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

const AutomationBadge = () => (
  <div className='bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full px-2 py-1 text-xs font-medium'>
    Auto
  </div>
)
