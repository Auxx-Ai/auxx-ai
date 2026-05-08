// apps/web/src/components/fields/ai-overlay/ai-generating-indicator-css.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { AnimatedDots } from '~/components/kopilot/ui/kopilot-status-bar'

/**
 * Pure-CSS twin of `AiGeneratingIndicator`. Same visual design — shimmering
 * "Generating" + animated dots — but driven by the existing `text-shimmer`
 * keyframe in global.css instead of framer-motion. Use this in heavily
 * memoized list rows where motion's animate prop can stall.
 */
export function AiGeneratingIndicatorCss({ className }: { className?: string }) {
  return (
    <div
      role='status'
      aria-live='polite'
      aria-label='Generating AI value'
      className={cn('flex items-center pointer-events-none', className)}>
      <span className='animate-text-shimmer-smooth [animation-duration:4s] [animation-direction:reverse] inline-block bg-clip-text text-transparent [background-image:linear-gradient(90deg,#a1a1aa_40%,#000_50%,#a1a1aa_60%)] [background-size:250%_100%] dark:[background-image:linear-gradient(90deg,#71717a_40%,#ffffff_50%,#71717a_60%)]'>
        Generating
      </span>
      <AnimatedDots />
    </div>
  )
}
