import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

// Textarea variants using cva
const textareaVariants = cva(
  'flex min-h-[60px] w-full rounded-xl border px-3 py-2 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-primary-500 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
  {
    variants: {
      variant: {
        default:
          // ' border-primary-200 focus:border-primary-300 bg-primary-50 dark:bg-primary-100 focus:ring-primary-400 placeholder:text-primary-500',
          'h-24 border-primary-200 dark:border-[#2c313a] focus:border-primary-300 bg-primary-50 dark:bg-[#1e2227] dark:text-primary-600',
        transparent: 'h-24 border-none bg-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    VariantProps<typeof textareaVariants> {
  /**
   * React 19 passes `ref` to function components as an ordinary prop, but
   * `TextareaHTMLAttributes` does not declare it — so a caller that needs to focus
   * the field (a progressively-disclosed note, say) got a type error on a prop that
   * works at runtime. Declared here rather than reached around with `getElementById`.
   */
  ref?: React.Ref<HTMLTextAreaElement>
}

function Textarea({ className, variant, ...props }: TextareaProps) {
  return <textarea className={cn(textareaVariants({ variant, className }))} {...props} />
}
Textarea.displayName = 'Textarea'

export { Textarea, textareaVariants }
