// apps/web/src/components/ui/input.tsx
'use client'
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@auxx/ui/lib/utils'

// Input variants using cva
const inputVariants = cva(
  'flex w-full rounded-xl border px-3 py-1 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
  {
    variants: {
      variant: {
        default:
          'h-8 border-primary-200 focus:border-primary-300 bg-primary-50 dark:bg-primary-100 focus:ring-primary-400 placeholder:text-primary-500',
        secondary: 'bg-muted/50 hover:bg-muted focus-visible:bg-muted focus-visible:ring-0',
        transparent:
          'h-9 border-none bg-transparent shadow-none focus-visible:ring-0 placeholder:text-primary-400',
      },
      size: { default: '', sm: 'h-7 px-2 text-xs' },
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
    <input type={type} className={cn(inputVariants({ variant, size, className }))} {...props} />
  )
}
Input.displayName = 'Input'

export { Input, inputVariants }
