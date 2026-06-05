// apps/web/src/components/global/tooltip.tsx
'use client'

import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { HelpCircleIcon } from 'lucide-react'
import type * as React from 'react'

export type { SimpleTooltipProps as TooltipProps } from '@auxx/ui/components/tooltip'
// The Tooltip implementation now lives in `@auxx/ui/components/tooltip` as
// `SimpleTooltip` (the package already owns the Radix `Tooltip` primitive).
// Re-exported here as `Tooltip` so existing app imports keep working.
export { SimpleTooltip as Tooltip } from '@auxx/ui/components/tooltip'

const tooltipIconVariants = cva('cursor-pointer', {
  variants: { size: { sm: 'h-4 w-4', md: 'h-5 w-5' } },
  defaultVariants: { size: 'sm' },
})

interface TooltipExplanationProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tooltipIconVariants> {
  text: string
}

export function TooltipExplanation({ text, size, className }: TooltipExplanationProps) {
  return (
    <SimpleTooltip content={text}>
      <HelpCircleIcon
        className={cn('text-primary-400', tooltipIconVariants({ size }), className)}
      />
    </SimpleTooltip>
  )
}
