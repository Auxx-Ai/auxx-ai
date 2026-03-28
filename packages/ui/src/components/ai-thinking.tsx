// packages/ui/src/components/ai-thinking.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

export const AiThinking = () => {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(true)

      const hideTimer = setTimeout(() => {
        setShow(false)
      }, 100)

      return () => clearTimeout(hideTimer)
    }, 4000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div aria-hidden className='group relative m-auto size-fit'>
      <div
        className='mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] absolute -inset-6 z-10 opacity-30'
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.6) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)
          `,
          backgroundSize: '5px 5px',
        }}
      />

      <div className='absolute inset-0 animate-spin opacity-50 blur-lg duration-[3s] dark:opacity-20'>
        <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-0 rounded-full from-pink-300 to-indigo-300' />
      </div>
      <div className='animate-scan absolute inset-x-12 inset-y-0 z-10'>
        <div className='absolute inset-x-0 m-auto h-6 rounded-full bg-white/50 blur-2xl' />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 1.5, type: 'spring' }}
        className='aspect-2/3 absolute inset-0 z-10 m-auto w-24'>
        <CardDecorator className='scale-125 border-white blur-[3px]' />
        <motion.div
          initial={{ '--frame-color': 'white' }}
          animate={{ '--frame-color': 'var(--color-lime-400)' }}
          transition={{ duration: 0.4, delay: 3.5, type: 'spring' }}>
          <CardDecorator className='border-(--frame-color) z-10' />
        </motion.div>
      </motion.div>

      {show && (
        <div className='absolute inset-0 z-10 scale-150 rounded-full bg-white mix-blend-overlay blur-xl' />
      )}

      <div className='bg-radial aspect-square max-w-xs [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]'>
        <div className='bg-muted flex size-full items-center justify-center rounded-full'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
            className='text-muted-foreground size-24'>
            <circle cx='12' cy='8' r='4' />
            <path d='M20 21a8 8 0 0 0-16 0' />
          </svg>
        </div>
      </div>
    </div>
  )
}

export const CardDecorator = ({ className }: { className?: string }) => (
  <>
    <span
      className={cn(
        'absolute -left-px -top-px block size-2.5 border-l-[1.5px] border-t-[1.5px] border-white',
        className
      )}
    />
    <span
      className={cn(
        'absolute -right-px -top-px block size-2.5 border-r-[1.5px] border-t-[1.5px] border-white',
        className
      )}
    />
    <span
      className={cn(
        'absolute -bottom-px -left-px block size-2.5 border-b-[1.5px] border-l-[1.5px] border-white',
        className
      )}
    />
    <span
      className={cn(
        'absolute -bottom-px -right-px block size-2.5 border-b-[1.5px] border-r-[1.5px] border-white',
        className
      )}
    />
  </>
)

export default AiThinking
