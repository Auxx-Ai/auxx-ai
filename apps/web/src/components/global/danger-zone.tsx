// apps/web/src/components/global/danger-zone.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { type LucideIcon, TriangleAlert } from 'lucide-react'
import type React from 'react'

interface DangerZoneProps {
  /** Card heading, e.g. "Delete integration". */
  title: React.ReactNode
  /** Optional supporting copy under the card heading. */
  description?: React.ReactNode
  /**
   * Action element — usually a destructive `Button` (optionally wrapped in an
   * `AdminGate`). Sits to the right of the text on wide cards and stacks below
   * it once the card itself gets narrow (container-query driven, so it responds
   * to the available space rather than the viewport).
   */
  action: React.ReactNode
  /** Icon shown in the card badge. Defaults to {@link TriangleAlert}. */
  icon?: LucideIcon
  /** Extra classes for the card wrapper. */
  className?: string
}

/**
 * Standardized "Danger zone" card: a destructive-outlined row with an icon
 * badge, title, description, and an action. Used for delete/remove actions
 * across settings and detail pages so they read the same everywhere. Wrap it in
 * a `SettingsSection` at the call site when it needs a section header.
 */
export function DangerZone({
  title,
  description,
  action,
  icon: Icon = TriangleAlert,
  className,
}: DangerZoneProps) {
  return (
    <div
      className={cn(
        '@container group rounded-2xl border border-destructive/50 px-3 py-2 transition-colors duration-200 hover:bg-destructive/2',
        className
      )}>
      <div className='flex flex-col justify-between gap-1 @md:gap-4 @md:flex-row @md:items-center'>
        <div className='flex items-center gap-3'>
          <div className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-destructive/10 bg-destructive/2 transition-colors group-hover:bg-destructive/5'>
            <Icon className='size-4 text-destructive' />
          </div>
          <div className='flex flex-col'>
            <span className='text-sm text-destructive font-bold'>{title}</span>
            {description && <span className='text-xs text-destructive/80'>{description}</span>}
          </div>
        </div>
        {/* Stacked (narrow) → line the action up with the text, not the icon badge
            (badge size-8 + gap-3 = pl-11); inline (wide) → back to the right edge. */}
        <div className='shrink-0 pl-11 @md:pl-0'>{action}</div>
      </div>
    </div>
  )
}
