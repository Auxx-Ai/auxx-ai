// packages/ui/src/components/alert.tsx

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'

/**
 * Two columns: the icon, then everything else.
 *
 * The icon is a real grid item rather than an absolutely-positioned one, so an
 * Alert can hold a title, a description AND an action without the action being
 * dragged into the icon's gutter. `[&>*:not(svg)]:col-start-2` is what keeps a
 * bare `<div>`, `<span>` or `<Button>` child landing in the content column
 * without every call site having to say so.
 *
 * Content sits at the same x as before the grid (12px padding + 16px icon +
 * 12px gap = 40px, previously 12px padding + 28px `pl-7`); the icon itself
 * moves 4px left, onto the padding edge it always should have been on.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-2xl border px-3 py-2 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-3 [&>*:not(svg)]:col-start-2 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-foreground',
  {
    variants: {
      // Every tone carries a faint wash of its own color so a destructive and
      // a warning Alert read as the same kind of object. Only `outline` and
      // `translucent` opt out, because both exist to sit on a surface that
      // already has one.
      variant: {
        default: 'bg-background text-foreground',
        neutral: 'bg-muted/40 text-foreground [&>svg]:text-muted-foreground',
        outline: ' text-muted-foreground hover:bg-muted transition-colors duration-200',
        destructive:
          'border-destructive/50 bg-destructive/5 text-destructive dark:border-destructive [&>svg]:text-destructive',
        warning:
          'border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-500 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-500',
        success:
          'border-green-500/50 bg-green-500/5 text-green-700 dark:border-green-500 dark:text-green-400 [&>svg]:text-green-600 dark:[&>svg]:text-green-400',
        good: 'border-good-500/50 bg-good-50 text-good-500 dark:border-good-500 [&>svg]:text-good-500',
        blue: 'border-blue-500/50 bg-blue-500/5 text-blue-500 dark:border-blue-500 [&>svg]:text-blue-500',
        comparison:
          'border-comparison-200 bg-comparison-100 dark:bg-black/20 text-comparison-500 [&>svg]:text-comparison-500',
        bad: 'border-bad-200 bg-bad-50 dark:bg-black/20 text-bad-500 [&>svg]:text-bad-500',
        accent: 'border-accent-200 bg-accent-50 text-accent-500 [&>svg]:text-accent-500',
        translucent: 'border-transparent bg-white/10 text-white/80 [&>svg]:text-white/80',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

const Alert = ({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) => (
  <div role='alert' className={cn(alertVariants({ variant }), className)} {...props} />
)

const AlertTitle = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <h5
    className={cn(
      'font-medium leading-none tracking-tight flex items-center gap-2 [&>svg]:size-4',
      className
    )}
    {...props}
  />
)

/**
 * The body. Inherits the variant's color and drops to 70% so a tone reads as
 * one block rather than a colored heading with unrelated grey text under it.
 */
const AlertDescription = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('text-sm [&_p]:leading-relaxed opacity-70', className)} {...props} />
)

type AlertIconProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  icon: LucideIcon
}

const AlertIcon = ({ className, icon: Icon, ...props }: AlertIconProps) => (
  <div
    className={cn(
      'size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0',
      className
    )}
    {...props}>
    <Icon className='size-4' aria-hidden='true' />
  </div>
)

export { Alert, AlertTitle, AlertIcon, AlertDescription }
