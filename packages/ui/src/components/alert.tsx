import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'

const alertVariants = cva(
  'relative w-full items-center rounded-2xl border px-3 py-2 text-sm [&>svg]:absolute [&>svg]:size-4 [&>svg]:left-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        outline: ' text-muted-foreground hover:bg-muted transition-colors duration-200',
        destructive:
          'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
        warning:
          'border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-500 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-500',
        success: 'border-green-500/50 text-green-500 dark:border-green-500 [&>svg]:text-green-500',
        good: 'border-good-500/50 bg-good-50 text-good-500 dark:border-good-500 [&>svg]:text-good-500',
        blue: 'border-blue-500/50 text-blue-500 dark:border-blue-500 [&>svg]:text-blue-500',
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
      'mb-1 font-medium leading-none tracking-tight flex items-center gap-2 [&>svg]:size-4',
      className
    )}
    {...props}
  />
)

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
