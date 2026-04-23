// apps/web/src/components/fields/ai-overlay/ai-generating-indicator.tsx

'use client'

import { TextShimmer } from '@auxx/ui/components/text-shimmer'
import { cn } from '@auxx/ui/lib/utils'
import { AnimatedDots } from '~/components/kopilot/ui/kopilot-status-bar'

/**
 * Shimmer + animated dots used while an AI value is being generated. One
 * source of truth for the copy and a11y attributes so cell overlays and
 * property rows render the same thing.
 */
export function AiGeneratingIndicator({ className }: { className?: string }) {
  return (
    <div
      role='status'
      aria-live='polite'
      aria-label='Generating AI value'
      className={cn('flex items-center pointer-events-none', className)}>
      <TextShimmer as='span'>Generating</TextShimmer>
      <AnimatedDots />
    </div>
  )
}
