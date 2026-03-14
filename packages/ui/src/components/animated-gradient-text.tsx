// packages/ui/src/components/animated-gradient-text.tsx

import { cn } from '@auxx/ui/lib/utils'
import type { ComponentPropsWithoutRef } from 'react'

export interface AnimatedGradientTextProps extends ComponentPropsWithoutRef<'span'> {
  speed?: number
  colorFrom?: string
  colorTo?: string
}

export function AnimatedGradientText({
  children,
  className,
  speed = 1,
  colorFrom = '#ffaa40',
  colorTo = '#9c40ff',
  ...props
}: AnimatedGradientTextProps) {
  return (
    <span
      style={
        {
          '--bg-size': `${speed * 300}%`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
        } as React.CSSProperties
      }
      className={cn(
        'animate-gradient inline bg-linear-to-r from-(--color-from) via-(--color-to) to-(--color-from) bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent',
        className
      )}
      {...props}>
      {children}
    </span>
  )
}
