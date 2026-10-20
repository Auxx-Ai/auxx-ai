// apps/homepage/src/app/builder/_components/app-shot.tsx

import Image from 'next/image'
import { type TapeApp, TapeBand } from '~/components/tape-mark'
import { cn } from '~/lib/utils'
import type { Shot } from '../_data/content'

/**
 * A screenshot of one of the apps in the site's frame, with the app's tape bands along its
 * bottom edge like the label of a cassette.
 */
export function AppShot({
  shot,
  app,
  className,
  priority,
  sizes = '(max-width: 768px) 100vw, 640px',
}: {
  shot: Shot
  app: TapeApp
  className?: string
  priority?: boolean
  sizes?: string
}) {
  return (
    <figure
      className={cn(
        'bg-background ring-foreground/10 overflow-hidden rounded-xl shadow-lg shadow-black/10 ring-1',
        className
      )}>
      <Image
        src={shot.src}
        alt={shot.alt}
        width={shot.width}
        height={shot.height}
        sizes={sizes}
        priority={priority}
        className='block h-auto w-full'
      />
      <TapeBand apps={[app]} className='h-1.5' />
    </figure>
  )
}
