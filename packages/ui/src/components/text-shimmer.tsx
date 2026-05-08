// packages/ui/src/components/text-shimmer.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import React, { useMemo } from 'react'

export type TextShimmerProps = {
  children: string
  as?: React.ElementType
  className?: string
  /** Duration of one full sweep, in seconds. Defaults to 4. */
  duration?: number
  /** Pixels per character; controls the width of the highlight band. */
  spread?: number
}

/**
 * CSS-only text shimmer. Pure keyframe animation (`text-shimmer-smooth`
 * defined in global.css) — no framer-motion, so it renders reliably in
 * memoized list rows. Sweeps right-to-left at constant speed; override
 * `duration` per instance.
 *
 * For the legacy framer-motion implementation see `TextShimmerMotion` in
 * `./text-shimmer-motion`.
 */
function TextShimmerComponent({
  children,
  as: Component = 'p',
  className,
  duration = 4,
  spread = 2,
}: TextShimmerProps) {
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread])

  return (
    <Component
      className={cn(
        'animate-text-shimmer-smooth [animation-direction:reverse] bg-size-[250%_100%,auto] relative inline-block bg-clip-text',
        'text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#000]',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        'dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff] dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]',
        className
      )}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          '--duration': `${duration}s`,
          backgroundImage: 'var(--bg), linear-gradient(var(--base-color), var(--base-color))',
        } as React.CSSProperties
      }>
      {children}
    </Component>
  )
}

export const TextShimmer = React.memo(TextShimmerComponent)
