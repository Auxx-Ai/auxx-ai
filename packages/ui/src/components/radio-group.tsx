'use client'

import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { Circle } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@auxx/ui/lib/utils'

const radioGroupVariants = cva(
  'aspect-square shrink-0 rounded-full shadow-sm focus:outline-hidden focus-visible:ring-[1px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-colors',
  {
    variants: {
      variant: {
        default: 'border border-foreground text-foreground [&_svg]:fill-foreground',
        outline: 'border border-input text-foreground hover:bg-accent/50 [&_svg]:fill-foreground',
        ghost:
          'border border-transparent hover:border-input text-foreground [&_svg]:fill-foreground',
        card: 'border border-input bg-card text-card-foreground shadow-sm hover:shadow-md [&_svg]:fill-card-foreground',
        solid:
          'border border-primary bg-primary/10 text-primary hover:bg-primary/20 [&_svg]:fill-primary',
        accent: 'border border-info text-info hover:bg-info/5 [&_svg]:fill-info',
      },
      size: {
        xs: 'size-3',
        sm: 'size-3.5',
        default: 'size-4',
        lg: 'size-5',
        xl: 'size-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

const indicatorSizes: Record<string, string> = {
  xs: 'size-1.5',
  sm: 'size-1.5',
  default: 'size-2',
  lg: 'size-2.5',
  xl: 'size-3',
}

export interface RadioGroupItemProps
  extends React.ComponentProps<typeof RadioGroupPrimitive.Item>,
    VariantProps<typeof radioGroupVariants> {
  indicatorClassName?: string
}

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-3', className)} {...props} />
}

function RadioGroupItem({
  className,
  variant,
  size = 'default',
  indicatorClassName,
  ...props
}: RadioGroupItemProps) {
  const indicatorSize = indicatorSizes[size as string] || indicatorSizes.default

  return (
    <RadioGroupPrimitive.Item
      className={cn(radioGroupVariants({ variant, size, className }))}
      {...props}>
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className={cn(indicatorSize, indicatorClassName)} />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, radioGroupVariants }
