// apps/web/src/components/ui/input.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

// Input variants using cva
const inputVariants = cva(
  'flex w-full rounded-xl border px-3 py-1 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
  {
    variants: {
      variant: {
        default:
          'h-8 border-primary-200 dark:border-[#2c313a] focus:border-primary-300 dark:text-primary-600 bg-primary-50 dark:bg-[#1e2227] focus:ring-primary-400 placeholder:text-primary-500',
        secondary: 'bg-muted/50 hover:bg-muted focus-visible:bg-muted focus-visible:ring-0',
        transparent:
          'h-9 border-none bg-transparent shadow-none focus-visible:ring-0 placeholder:text-primary-400',
        translucent:
          'border-none bg-[#0519453d] text-white shadow-none placeholder:text-white/60 focus-visible:ring-white/30',
      },
      size: { default: '', sm: 'h-7 px-2 text-xs', lg: 'h-9 px-4 text-lg' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

// Input component
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

function Input({ className, type, variant, size, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-variant={variant}
      className={cn(inputVariants({ variant, size, className }))}
      {...props}
    />
  )
}
Input.displayName = 'Input'

export { Input, inputVariants }
