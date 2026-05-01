// packages/ui/src/components/banner.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

const bannerVariants = cva('relative flex items-center gap-3 px-3 py-1.5 text-sm', {
  variants: {
    variant: {
      default: 'bg-primary-150 text-foreground',
      info: 'bg-blue-50 dark:bg-blue-600/10 text-foreground',
      warning: 'bg-amber-50 dark:bg-amber-950/30 text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

const iconVariants = cva('shrink-0 [&>svg]:size-4', {
  variants: {
    variant: {
      default: 'text-foreground/70',
      info: 'text-info',
      warning: 'text-amber-600 dark:text-amber-400',
    },
  },
  defaultVariants: { variant: 'default' },
})

interface BannerProps extends VariantProps<typeof bannerVariants> {
  /** Optional leading icon (typically a lucide-react icon node). */
  icon?: ReactNode
  /** Bold lead label. Rendered before `children`. */
  title?: ReactNode
  /** Body text / inline links. */
  children?: ReactNode
  /** Right-aligned slot (button, link, badge…). */
  action?: ReactNode
  /** When set, renders an absolutely-positioned X close button at the right edge. */
  onClose?: () => void
  className?: string
}

/**
 * Slim full-width strip used for app-level notices (preview mode, demo countdown, plan overage).
 * Variant controls colors only; layout is fixed (icon + content + right-aligned action + optional dismiss).
 * A subtle gradient + border at the bottom edge gives the banner a "floating above content" feel.
 */
export function Banner({
  variant = 'default',
  icon,
  title,
  children,
  action,
  onClose,
  className,
}: BannerProps) {
  return (
    <div className='relative z-10'>
      <div role='note' className={cn(bannerVariants({ variant }), onClose && 'pr-10', className)}>
        {icon ? <span className={iconVariants({ variant })}>{icon}</span> : null}
        <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5'>
          {title ? <span className='font-medium'>{title}</span> : null}
          {children ? <span className='text-muted-foreground'>{children}</span> : null}
        </div>
        {action ? <div className='ml-auto flex items-center gap-2'>{action}</div> : null}
        {onClose ? (
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            onClick={onClose}
            className='absolute right-1 top-1/2 -translate-y-1/2 text-foreground/70 hover:opacity-70'
            aria-label='Dismiss'>
            <X />
          </Button>
        ) : null}
      </div>
      <div className='pointer-events-none absolute bottom-0 inset-x-0 z-20 h-2 shrink-0 border-b border-black/20 bg-gradient-to-t from-black/10 to-transparent transition-opacity duration-300' />
    </div>
  )
}

export { bannerVariants }
export type { BannerProps }
