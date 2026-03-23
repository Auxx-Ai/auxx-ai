// apps/web/src/components/global/login/colorful-bg.tsx

import { Meteors } from '@auxx/ui/components/meteors'
import Image from 'next/image'
import type { ReactNode } from 'react'

function WelcomeBackgroundGrid({ className }: { className?: string }) {
  return (
    <svg
      width='1750'
      height='1046'
      viewBox='0 0 1750 1046'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}>
      <g transform='translate(-1, -13)'>
        <rect width='120%' height='120%' fill='url(#grid)' />
      </g>
      <defs>
        <pattern id='smallGrid' width='12' height='12' patternUnits='userSpaceOnUse'>
          <path d='M 12 0 L 0 0 0 12' fill='none' stroke='#00000014' strokeWidth='0.5' />
        </pattern>
        <pattern id='grid' width='120' height='120' patternUnits='userSpaceOnUse'>
          <rect width='120' height='120' fill='url(#smallGrid)' />
          <path d='M 120 0 L 0 0 0 120' fill='none' stroke='#00000009' strokeWidth='1' />
        </pattern>
      </defs>
    </svg>
  )
}

interface ColorfulBgProps {
  children?: ReactNode
}

function ColorfulBg({ children }: ColorfulBgProps) {
  return (
    <div data-theme='dark' className='relative min-h-screen overflow-hidden'>
      <div className='pointer-events-none fixed inset-0 overflow-hidden transition-opacity duration-300 '>
        <Meteors
          count={40}
          angle={330}
          color='rgba(255,255,255,0.5)'
          tailColor='rgba(255,255,255,0.5)'
        />
        <div className='absolute inset-0 overflow-hidden mask-[radial-gradient(70%_100%_at_50%_0%,black_70%,transparent)] opacity-15' />
        <Image
          src='/mountains-night.webp'
          alt='gradient background'
          className='size-full object-cover'
          width={2342}
          height={1561}
          priority
          fetchPriority='high'
        />
        <div className='mask-b-from-55% mask-b-to-75% mask-radial-from-45% mask-radial-at-bottom mask-radial-[125%_80%] lg:aspect-7/5 absolute inset-0'>
          <Image
            src='/mountains-night.webp'
            alt='gradient background'
            className='size-full object-cover'
            width={2342}
            height={1561}
            priority
            fetchPriority='high'
          />
        </div>
        <div className='z-20 absolute left-1/2 top-0 -translate-x-1/2 opacity-50 transition-all sm:opacity-100'>
          <WelcomeBackgroundGrid className='absolute inset-0 brightness-[3] invert' />
          <WelcomeBackgroundGrid className='relative min-w-[1000px] max-w-(--breakpoint-2xl) transition-opacity duration-300 opacity-0 brightness-[3] invert' />
        </div>
      </div>
      <div className='flex flex-col h-full flex-1 z-40 relative'>{children}</div>
    </div>
  )
}

export { ColorfulBg, WelcomeBackgroundGrid }
