import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

// Textarea variants using cva
const textareaVariants = cva(
  'flex min-h-[60px] w-full rounded-xl border px-3 py-2 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
  {
    variants: {
      variant: {
        default:
          'h-24 border-primary-200 focus:border-primary-300 bg-primary-50 dark:bg-primary-100 focus:ring-primary-400 placeholder:text-primary-500',
        transparent: 'h-24 border-none bg-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    VariantProps<typeof textareaVariants> {}

function Textarea({ className, variant, ...props }: TextareaProps) {
  return <textarea className={cn(textareaVariants({ variant, className }))} {...props} />
}
Textarea.displayName = 'Textarea'

export { Textarea, textareaVariants }
