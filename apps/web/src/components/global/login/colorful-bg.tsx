// apps/web/src/components/global/colorful-bg.tsx

import { AnimatedGridPattern } from '@auxx/ui/components/animated-grid-pattern'
import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode } from 'react'

interface ColorfulBgProps {
  children?: ReactNode
}

function ColorfulBg({ children }: ColorfulBgProps) {
  return (
    <div data-theme='light'>
      <div className='pointer-events-none fixed inset-0 overflow-hidden bg-white dark:bg-black transition-opacity duration-300 opacity-60'>
        <div className='absolute left-0 top-0 aspect-square w-full overflow-hidden sm:aspect-2/1 mask-[radial-gradient(70%_100%_at_50%_0%,black_70%,transparent)] opacity-15'>
          <div
            className='absolute inset-0 saturate-150'
            style={{
              backgroundImage:
                'conic-gradient(from -45deg at 50% -10%, rgb(58, 139, 253) 0deg, rgb(255, 0, 0) 172.98deg, rgb(133, 90, 252) 215.14deg, rgb(255, 123, 0) 257.32deg, rgb(58, 139, 253) 360deg)',
            }}></div>
          <div className='absolute inset-0 backdrop-blur-[100px]'></div>
        </div>
        <div className='absolute left-1/2 top-0 -translate-x-1/2 opacity-50 transition-all sm:opacity-100'>
          {/* <img alt="" loading="lazy" width="1750" height="1046" decoding="async" data-nimg="1" className="absolute inset-0" src="https://assets.dub.co/misc/welcome-background-grid.svg" style="color: transparent;">
      <img alt="" loading="lazy" width="1750" height="1046" decoding="async" data-nimg="1" className="relative min-w-[1000px] max-w-(--breakpoint-2xl) transition-opacity duration-300 opacity-0" src="https://assets.dub.co/misc/welcome-background.svg" style="color: transparent;"> */}
        </div>
        <div className='absolute left-0 top-0 aspect-square w-full overflow-hidden sm:aspect-2/1 mask-[radial-gradient(70%_100%_at_50%_0%,black_70%,transparent)] opacity-100 mix-blend-soft-light'>
          <div
            className='absolute inset-0 saturate-150'
            style={{
              backgroundImage:
                'conic-gradient(from -45deg at 50% -10%, rgb(58, 139, 253) 0deg, rgb(255, 0, 0) 172.98deg, rgb(133, 90, 252) 215.14deg, rgb(255, 123, 0) 257.32deg, rgb(58, 139, 253) 360deg)',
            }}></div>
          <div className='absolute inset-0 backdrop-blur-[100px]'></div>
        </div>
      </div>
      <div className='flex flex-col h-full flex-1 z-40 relative'>{children && children}</div>
      <AnimatedGridPattern
        numSquares={100}
        maxOpacity={0.3}
        duration={3}
        repeatDelay={1}
        className={cn(
          '[mask-image:radial-gradient(500px_circle_at_center,white,transparent)]',
          'inset-x-0 h-full skew-y-12 z-30'
        )}
      />
    </div>
  )
}

export { ColorfulBg }
