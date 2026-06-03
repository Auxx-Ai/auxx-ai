// packages/ui/src/components/toggle-card.tsx

'use client'

import { AnimatedCollapsibleContent } from '@auxx/ui/components/collapsible'
import { Label } from '@auxx/ui/components/label'
import { Switch, type SwitchProps } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

export interface ToggleCardProps {
  /** Title shown on the left of the header row. */
  title: React.ReactNode
  /** Muted helper text below the title. */
  description?: React.ReactNode
  /** Optional icon rendered before the title. Size it yourself (e.g. `size-3.5`). */
  icon?: React.ReactNode
  /** Current on/off state. */
  checked: boolean
  /** Fired when the switch (or header row) toggles. */
  onCheckedChange: (next: boolean) => void
  /** Disables the switch and header-click toggle. */
  disabled?: boolean
  /**
   * When true, `children` are revealed below the header (separated by a top
   * border) while `checked`. Omit for a plain toggle row with no body.
   */
  collapsible?: boolean
  /** Body content, shown when `collapsible && checked`. */
  children?: React.ReactNode
  /** Let a click anywhere on the header toggle the switch (default true). */
  rowClickToggles?: boolean
  /** Switch size — defaults to `sm` to match the compact card look. */
  switchSize?: SwitchProps['size']
  /** Override the outer card classes. */
  className?: string
  /** Extra classes for the inner body wrapper (e.g. `space-y-3`, `flex gap-4`). */
  contentClassName?: string
}

/**
 * Settings card with a title/description on the left and a `Switch` on the
 * right. Toggling on can reveal collapsible body content below. Use for the
 * recurring "enable this feature + configure it" pattern across the app.
 */
export function ToggleCard({
  title,
  description,
  icon,
  checked,
  onCheckedChange,
  disabled = false,
  collapsible = false,
  children,
  rowClickToggles = true,
  switchSize = 'sm',
  className,
  contentClassName,
}: ToggleCardProps) {
  const interactive = rowClickToggles && !disabled

  return (
    <div className={cn('rounded-xl border px-3 py-2.5', className)}>
      <div
        className={cn('flex items-center justify-between', interactive && 'cursor-pointer')}
        onClick={interactive ? () => onCheckedChange(!checked) : undefined}>
        <div className='space-y-0.5 leading-none'>
          <Label
            className={cn(
              'flex items-center gap-1.5 text-sm font-medium',
              interactive && 'cursor-pointer'
            )}>
            {icon}
            {title}
          </Label>
          {description && <p className='text-xs text-muted-foreground'>{description}</p>}
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            size={switchSize}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
          />
        </div>
      </div>

      {collapsible && (
        <AnimatedCollapsibleContent open={checked}>
          <div className={cn('mt-3 border-t pt-3', contentClassName)}>{children}</div>
        </AnimatedCollapsibleContent>
      )}
    </div>
  )
}
