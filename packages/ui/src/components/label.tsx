'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Label as LabelPrimitive } from 'radix-ui'
import type * as React from 'react'

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
)

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>) {
  return <LabelPrimitive.Root className={cn(labelVariants(), className)} {...props} />
}
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
