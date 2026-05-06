// apps/homepage/src/app/platform/ai/_mocks/mock-browser-chrome.tsx

import { cn } from '~/lib/utils'

interface MockBrowserChromeProps {
  variant?: 'regular' | 'compact'
  url?: string
  className?: string
  children: React.ReactNode
}

/**
 * Outer browser-window frame used to wrap product mocks on the homepage.
 *
 * - `regular` — full chrome with three traffic-light dots on the left and a
 *   centered URL pill. Use for hero-level mocks where the URL should read.
 * - `compact` — only the three traffic-light dots in the top-left, no URL bar.
 *   Use for in-section mocks where extra chrome would be noise.
 */
export function MockBrowserChrome({
  variant = 'regular',
  url = 'app.auxx.ai/app/chats',
  className,
  children,
}: MockBrowserChromeProps) {
  return (
    <div className={cn('relative rounded-3xl border border-border/50 p-2', className)}>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 scale-100 opacity-75 blur-lg transition-all duration-300 dark:opacity-50'>
        <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-x-6 bottom-0 top-12 -translate-y-3 from-pink-400 to-purple-400' />
      </div>
      <div className='relative overflow-hidden rounded-2xl bg-card/85 backdrop-blur-md text-card-foreground shadow-xl shadow-black/[.065] ring-1 ring-border-illustration'>
        {variant === 'regular' ? (
          <div className='relative grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border px-3 py-2'>
            <TrafficLights />
            <div className='flex justify-center'>
              <div className='inline-flex items-center rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground'>
                {url}
              </div>
            </div>
            <div className='w-12' aria-hidden />
          </div>
        ) : (
          <div className='border-b border-border px-3 py-2'>
            <TrafficLights />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

function TrafficLights() {
  return (
    <div className='flex items-center gap-1.5'>
      <span className='size-2.5 rounded-full bg-[#FF5F57] ring-1 ring-inset ring-black/10' />
      <span className='size-2.5 rounded-full bg-[#FEBC2E] ring-1 ring-inset ring-black/10' />
      <span className='size-2.5 rounded-full bg-[#28C840] ring-1 ring-inset ring-black/10' />
    </div>
  )
}
