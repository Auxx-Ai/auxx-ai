// packages/ui/src/components/text-shimmer.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'

interface TextShimmerProps {
  text: string
  spread?: string
  duration?: string
  className?: string
}

export function TextShimmer({
  text,
  spread = '8rem',
  duration = '2.5s',
  className,
}: TextShimmerProps) {
  return (
    <span
      className={cn(
        'animate-text-shimmer relative inline-block bg-clip-text text-transparent bg-size-[250%_100%] [background-repeat:no-repeat,padding-box] [--base-color:#a1a1aa] [--base-gradient-color:#000] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))] dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff] dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]',
        className
      )}
      style={
        {
          '--spread': spread,
          '--duration': duration,
          backgroundImage: 'var(--bg), linear-gradient(var(--base-color), var(--base-color))',
        } as React.CSSProperties
      }>
      {text}
    </span>
  )
}
