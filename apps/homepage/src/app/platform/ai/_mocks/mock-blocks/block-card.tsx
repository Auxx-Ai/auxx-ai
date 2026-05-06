// apps/homepage/src/app/platform/ai/_mocks/mock-blocks/block-card.tsx

'use client'

import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

interface BlockCardProps {
  hasHeader?: boolean
  hasFooter?: boolean
  indicator?: ReactNode
  primaryText?: string
  secondaryText?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}

/**
 * Visual port of `apps/web/src/components/kopilot/ui/blocks/block-card.tsx`.
 * Same nested-rounded frame: outer `rounded-3xl bg-card/25` + inner
 * `rounded-2xl bg-illustration`.
 */
export function MockBlockCard({
  hasHeader = true,
  hasFooter = false,
  indicator,
  primaryText,
  secondaryText,
  children,
  footer,
}: BlockCardProps) {
  return (
    <div className='rounded-3xl bg-card/25 p-2 shadow-lg shadow-black/[.065] ring-1 ring-border-illustration'>
      {hasHeader && (
        <div className='flex items-start justify-between px-2 pt-1'>
          <div className='flex items-center gap-2'>
            {indicator}
            {primaryText && (
              <span className='text-xs font-semibold text-foreground/90'>{primaryText}</span>
            )}
          </div>
          {secondaryText && <div className='text-sm text-foreground/50'>{secondaryText}</div>}
        </div>
      )}

      {children && (
        <div
          className={cn(
            'rounded-2xl bg-illustration p-2 ring-1 ring-border-illustration',
            hasHeader ? 'mt-2 mb-2' : 'mt-0',
            hasFooter ? 'mb-2' : 'mb-0'
          )}>
          {children}
        </div>
      )}

      {hasFooter && footer && (
        <div className='flex items-center justify-between gap-2 pr-0.5 pl-3'>{footer}</div>
      )}
    </div>
  )
}
