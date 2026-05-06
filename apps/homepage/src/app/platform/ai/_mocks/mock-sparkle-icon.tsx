// apps/homepage/src/app/platform/ai/_mocks/mock-sparkle-icon.tsx

import { AlertTriangle, Sparkles } from 'lucide-react'
import { cn } from '~/lib/utils'

/**
 * Visual port of `apps/web/src/components/kopilot/ui/sparkle-icon.tsx` for the
 * homepage Kopilot mock. Same variants, same Tailwind, same lucide icons.
 *
 * The driving keyframes (`hue-rotate`, `sparkle-float`) live in
 * `apps/homepage/src/app/globals.css`.
 */
export type SparkleIconVariant = 'generated' | 'stale' | 'empty' | 'generating' | 'error'

const VARIANT_STYLES: Record<SparkleIconVariant, { glow: string; sparkles: string }> = {
  generated: {
    glow: '',
    sparkles: '*:nth-2:text-purple-400 *:nth-3:text-purple-400',
  },
  stale: {
    glow: '',
    sparkles: '*:nth-2:text-transparent *:nth-3:text-transparent',
  },
  empty: {
    glow: 'opacity-40',
    sparkles: 'opacity-50 *:nth-2:text-purple-400 *:nth-3:text-purple-400',
  },
  generating: {
    glow: '',
    sparkles: 'animate-sparkle-float *:nth-2:text-purple-400 *:nth-3:text-purple-400',
  },
  error: {
    glow: '',
    sparkles: '*:nth-2:text-purple-400 *:nth-3:text-purple-400',
  },
}

export function MockSparkleIcon({
  className,
  variant = 'generated',
}: {
  className?: string
  variant?: SparkleIconVariant
}) {
  const v = VARIANT_STYLES[variant]
  return (
    <div className={cn('animate-hue-rotate relative size-fit', className)}>
      <div
        className={cn(
          'bg-conic/decreasing relative flex size-4.5 items-center justify-center rounded-full from-violet-500 via-lime-300 to-violet-400 blur-md',
          v.glow
        )}
      />
      <div className='absolute inset-0 flex items-center justify-center'>
        <Sparkles className={cn('size-3.5', v.sparkles)} />
      </div>
      {variant === 'error' && (
        <AlertTriangle
          className='absolute -top-1 -right-1 size-2.5 fill-background text-destructive'
          strokeWidth={2.5}
        />
      )}
    </div>
  )
}
