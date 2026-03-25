import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot as SlotPrimitive } from 'radix-ui'
import type * as React from 'react'

const buttonVariants = cva(
  `inline-flex items-center shrink-0 justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1
  focus-visible:ring-ring/20 dark:focus-visible:ring-ring/40 dark:focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_[data-slot=kbd-group]]:ml-1 [&:has([data-slot=kbd-group])]:pe-1.5`,
  {
    variants: {
      variant: {
        // default:
        default:
          'bg-info text-info-foreground inset-shadow-2xs inset-shadow-white/25  dark:from-info/75 dark:bg-linear-to-t border border-zinc-950/35 shadow-sm shadow-zinc-950/20 ring-0 transition-[filter] duration-200 hover:brightness-110 active:brightness-95 dark:border-0 dark:border-zinc-950/50',

        // 'bg-info inset-shadow-2xs inset-shadow-white/25 shadow-md shadow-zinc-950/20 ring-0 text-info-foreground transition-[filter] duration-200 hover:brightness-105 active:brightness-95 dark:border-0 dark:border-zinc-950/50 hover:bg-info/80 dark:text-white',
        // destructive:
        //   'border border-input text-destructive shadow-xs hover:bg-destructive/90 hover:text-destructive-foreground hover:border-destructive focus-visible:ring-blue-500',
        destructive:
          'from-destructive/85 to-destructive text-destructive-foreground inset-shadow-2xs inset-shadow-white/25 bg-linear-to-b dark:from-destructive/75 dark:bg-linear-to-t border border-zinc-950/35 shadow-md shadow-zinc-950/20 ring-0 transition-[filter] duration-200 hover:brightness-110 active:brightness-95 dark:border-0 dark:border-zinc-950/50',
        'destructive-hover':
          'border border-primary-150 bg-primary-100  hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 shadow-none hover:shadow-xs ',
        info: 'bg-info text-info-foreground shadow-xs hover:bg-info/80 dark:text-white',
        outline:
          'shadow-xs bg-linear-to-t hover:to-muted to-background from-muted dark:bg-none dark:bg-muted  dark:hover:bg-muted/80 dark:border-border border border-zinc-300 shadow-zinc-950/10 duration-200 inset-shadow-2xs inset-shadow-white dark:inset-shadow-transparent',
        // 'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:ring-blue-500',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        translucent: 'btn-translucent border-0 shadow-none',
        transparent: 'hover:bg-transparent',
        link: 'text-foreground underline-offset-4 hover:underline',
        input:
          'border hover:border-gray-300 dark:bg-primary-100 dark:border-foreground/10 hover:bg-primary-100 focus-within:border-blue-500 focus-within:bg-background focus-within:ring-1 focus-within:ring-blue-500 shadow-xs h-8 border-primary-200 focus:border-primary-300 bg-primary-50 focus:ring-primary-400 text-muted-foreground focus-visible:ring-blue-500',
      },
      size: {
        default: 'h-8 px-3',
        xs: 'h-6 rounded-lg px-2 text-xs gap-1 [&_svg]:size-3',
        sm: 'h-7 rounded-lg px-2 text-xs gap-1',
        lg: 'h-10 rounded-lg px-8',
        icon: 'size-8',
        'icon-xs': 'size-6 [&_svg]:size-3.5',
        'icon-sm': 'size-7 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  loadingText?: string
}

const hideLoadingText = ['icon', 'icon-xs', 'icon-sm']

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingText = 'Loading...',
  children,
  ...props
}: ButtonProps) {
  // Choose the component type based on asChild prop
  const Comp = asChild ? SlotPrimitive.Slot : 'button'

  return (
    <Comp
      data-slot={`button-${variant ?? 'default'}`}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={loading || props.disabled}
      aria-busy={loading}
      {...props}>
      {/* Show spinner when loading */}
      {!loading ? (
        children
      ) : (
        <>
          <Loader2 className='h-4 w-4 animate-spin' />
          {!hideLoadingText.includes(size) && loadingText}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
