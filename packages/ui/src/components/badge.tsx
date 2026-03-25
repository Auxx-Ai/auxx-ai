import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot as SlotPrimitive } from 'radix-ui'
import type * as React from 'react'

export type Variant = VariantProps<typeof badgeVariants>['variant']
export type Shape = VariantProps<typeof badgeVariants>['shape']

const badgeVariants = cva(
  'ring-1 ring-current/35 [&_svg]:shrink-0 has-[svg]:gap-1 cursor-default inline-flex items-center text-xs font-normal transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      shape: {
        default: 'rounded-[5px]',
        tag: 'rounded-[5px]',
      },
      variant: {
        default: 'ring-1 ring-input bg-primary-200 text-foreground',
        secondary:
          'ring-1 ring-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'ring-1 ring-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80',
        outline: 'ring-1 ring-border text-foreground',
        pill: 'ring-1 ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-neutral-800 dark:ring-neutral-800 px-2  py-0',
        user: 'ring-1 ring-info/20 bg-[#f2f4f7] shadow-xs gap-1 text-foreground/80 dark:bg-[#204684] cursor-pointer py-0',

        // Color variants matching Tailwind design system
        red: 'bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20',
        orange:
          'bg-orange-500/15 text-orange-700 hover:bg-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:hover:bg-orange-500/20',
        amber:
          'bg-amber-400/20 text-amber-700 hover:bg-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400 dark:hover:bg-amber-400/15',
        yellow:
          'bg-yellow-400/20 text-yellow-700 hover:bg-yellow-400/30 dark:bg-yellow-400/10 dark:text-yellow-300 dark:hover:bg-yellow-400/15',
        lime: 'bg-lime-400/20 text-lime-700 hover:bg-lime-400/30 dark:bg-lime-400/10 dark:text-lime-300 dark:hover:bg-lime-400/15',
        green:
          'bg-green-500/15 text-green-700 hover:bg-green-500/25 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20',
        emerald:
          'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20',
        teal: 'bg-teal-500/15 text-teal-700 hover:bg-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/20',
        cyan: 'bg-cyan-400/20 text-cyan-700 hover:bg-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300 dark:hover:bg-cyan-400/15',
        sky: 'bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20',
        blue: 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 dark:text-blue-400 dark:hover:bg-blue-500/25',
        indigo:
          'bg-indigo-500/15 text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-400 dark:hover:bg-indigo-500/20',
        violet:
          'bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:text-violet-400 dark:hover:bg-violet-500/20',
        purple:
          'bg-purple-500/15 text-purple-700 hover:bg-purple-500/25 dark:text-purple-400 dark:hover:bg-purple-500/20',
        fuchsia:
          'bg-fuchsia-400/15 text-fuchsia-700 hover:bg-fuchsia-400/25 dark:bg-fuchsia-400/10 dark:text-fuchsia-400 dark:hover:bg-fuchsia-400/20',
        pink: 'bg-pink-400/15 text-pink-700 hover:bg-pink-400/25 dark:bg-pink-400/10 dark:text-pink-400 dark:hover:bg-pink-400/20',
        rose: 'bg-rose-400/15 text-rose-700 hover:bg-rose-400/25 dark:bg-rose-400/10 dark:text-rose-400 dark:hover:bg-rose-400/20',
        zinc: 'bg-zinc-600/10 text-zinc-700 hover:bg-zinc-600/20 dark:bg-white/5 dark:text-zinc-400 dark:hover:bg-white/10',
        gray: 'bg-zinc-600/10 text-zinc-700 hover:bg-zinc-600/20 dark:bg-white/5 dark:text-zinc-400 dark:hover:bg-white/10',
      },
      size: {
        default: 'px-2.5 py-0.5 [&_svg]:size-3 has-[svg]:ps-1.5',
        xs: 'px-1 py-0 text-xs',
        sm: 'px-2 py-[1px] text-xs [&_svg]:size-3 has-[svg]:ps-1',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', shape: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

function Badge({ className, variant, size, shape, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? SlotPrimitive.Slot : 'div'
  return <Comp className={cn(badgeVariants({ variant, size, shape }), className)} {...props} />
}

export { Badge, badgeVariants }
