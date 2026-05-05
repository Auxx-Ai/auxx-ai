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
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl shadow-black/5',
        className
      )}>
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
  )
}

function TrafficLights() {
  return (
    <div className='flex items-center gap-1.5'>
      <span className='size-2.5 rounded-full bg-foreground/15' />
      <span className='size-2.5 rounded-full bg-foreground/15' />
      <span className='size-2.5 rounded-full bg-foreground/15' />
    </div>
  )
}
