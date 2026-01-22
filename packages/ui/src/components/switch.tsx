// apps/web/src/components/ui/switch.tsx
'use client'

import * as React from 'react'
import { Switch as SwitchPrimitives } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@auxx/ui/lib/utils'

/**
 * switchVariants - cva for Switch root element
 */
const switchVariants = cva(
  'peer inline-flex shrink-0 cursor-pointer items-center border-2 border-transparent shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ',
  {
    variants: {
      size: { default: 'h-5 w-9', sm: 'h-4 w-7', xs: 'h-3 w-5' },
      variant: {
        default: 'rounded-full',
        square: 'rounded',
        thin: 'h-3 w-9 border-transparent outline-offset-[6px] rounded border-none',
      },
      color: {
        default: 'data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-input',
        dark: 'data-[state=checked]:bg-primary-900 data-[state=unchecked]:bg-input',
      },
    },
    defaultVariants: { size: 'default', variant: 'default', color: 'default' },
  }
)

/**
 * thumbVariants - cva for Switch thumb element
 */
const thumbVariants = cva(
  'pointer-events-none block  shadow-lg ring-0 transition-transform  data-[state=unchecked]:translate-x-0',
  {
    variants: {
      size: {
        default: 'size-4 data-[state=checked]:translate-x-4',
        sm: 'size-3 data-[state=checked]:translate-x-3',
        xs: 'size-2 data-[state=checked]:translate-x-2',
      },
      color: { default: 'bg-background dark:bg-foreground/50', dark: 'bg-secondary' },
      variant: {
        default: 'rounded-full',
        square: 'rounded',
        thin: 'rounded-full size-5 border-input data-[state=checked]:translate-x-4 border',
      },
    },
    defaultVariants: { size: 'default', variant: 'default', color: 'default' },
  }
)

/**
 * SwitchProps interface for Switch component
 */
export interface SwitchProps
  extends Omit<React.ComponentProps<typeof SwitchPrimitives.Root>, 'color'>,
    VariantProps<typeof switchVariants> {}

/**
 * Switch - UI switch component with size and variant support
 */
function Switch({ className, size, color, variant, ...props }: SwitchProps) {
  return (
    <SwitchPrimitives.Root
      className={cn(switchVariants({ size, variant, color, className }))}
      {...props}>
      <SwitchPrimitives.Thumb className={cn(thumbVariants({ size, variant, color }))} />
    </SwitchPrimitives.Root>
  )
}
Switch.displayName = 'Switch'

export { Switch, switchVariants, thumbVariants }
