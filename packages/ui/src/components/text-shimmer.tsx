// packages/ui/src/components/text-shimmer.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { motion } from 'motion/react'
import React, { useMemo } from 'react'

export type TextShimmerProps = {
  children: string
  as?: React.ElementType
  className?: string
  duration?: number
  spread?: number
}

// biome-ignore lint/suspicious/noExplicitAny: motion.create returns a dynamic component type
const motionCreateCache = new Map<React.ElementType, any>()

function getMotionComponent(el: React.ElementType) {
  if (!motionCreateCache.has(el)) {
    motionCreateCache.set(el, motion.create(el as keyof React.JSX.IntrinsicElements))
  }
  return motionCreateCache.get(el)!
}

function TextShimmerComponent({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const MotionComponent = getMotionComponent(Component)

  const dynamicSpread = useMemo(() => children.length * spread, [children, spread])

  return (
    <MotionComponent
      className={cn(
        'bg-size-[250%_100%,auto] relative inline-block bg-clip-text',
        'text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#000]',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        'dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff] dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]',
        className
      )}
      initial={{ backgroundPosition: '100% center' }}
      animate={{ backgroundPosition: '0% center' }}
      transition={{
        repeat: Number.POSITIVE_INFINITY,
        duration,
        ease: 'linear',
      }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage: 'var(--bg), linear-gradient(var(--base-color), var(--base-color))',
        } as React.CSSProperties
      }>
      {children}
    </MotionComponent>
  )
}

export const TextShimmer = React.memo(TextShimmerComponent)
