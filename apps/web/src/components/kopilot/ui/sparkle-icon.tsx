// apps/web/src/components/kopilot/ui/sparkle-icon.tsx

import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Sparkles } from 'lucide-react'

/**
 * Visual variants used by AI affordances to signal value state:
 * - generated:  has a fresh AI value — full glow + purple accent sparkles.
 * - stale:      had a value, inputs drifted — full glow, accent sparkles
 *               go transparent so the icon reads as "incomplete."
 * - empty:      never generated — glow + sparkles are dimmed to read as
 *               a latent action rather than a live result.
 * - generating: generation in flight — sparkle floats slowly up and down
 *               over the glow to signal "working."
 * - error:      last generation failed — sparkle base stays so the icon still
 *               reads as AI, with a destructive AlertTriangle satellite
 *               overlaid in the top-right corner.
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

export function SparkleIcon({
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
          className='absolute -top-1 -right-1 size-2.5 text-destructive fill-background'
          strokeWidth={2.5}
        />
      )}
    </div>
  )
}
