// packages/ui/src/components/responsive-tabs.tsx
/**
 * ResponsiveTabs
 *
 * A radio-tab strip that collapses to a dropdown on small screens. Takes an
 * `items` array (rather than children) so the same data can drive both the
 * desktop {@link RadioTab} and the mobile {@link Select}. The switch is purely
 * CSS-breakpoint based (`md`) to avoid hydration flicker from JS media queries.
 *
 * Use this for dense tab strips (5+ items). For 2-3 item strips, plain
 * `RadioTab` is fine on mobile — reach for this only when the row overflows.
 *
 * @example
 * ```tsx
 * <ResponsiveTabs
 *   value={section}
 *   onValueChange={setSection}
 *   items={[
 *     { value: 'general', label: 'General', icon: Settings },
 *     { value: 'ai', label: 'AI', icon: Bot },
 *   ]}
 * />
 * ```
 */
'use client'

import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import type * as React from 'react'

export interface ResponsiveTabItem {
  /** Stable identifier and the value reported via `onValueChange`. */
  value: string
  /** Visible label, shown in both the desktop tab and the mobile dropdown. */
  label: string
  /** Optional leading icon (e.g. a lucide icon component). */
  icon?: React.ComponentType<{ className?: string }>
  /** Disable selection of this item. */
  disabled?: boolean
  /** Optional tooltip for the desktop tab. */
  tooltip?: string
}

export interface ResponsiveTabsProps {
  /** Currently selected item value. */
  value: string
  /** Called with the new value when the selection changes. */
  onValueChange: (value: string) => void
  /** The tabs to render. */
  items: ResponsiveTabItem[]
  /** Size of the desktop tab strip and mobile trigger. */
  size?: 'default' | 'sm'
  /** Custom className for the desktop RadioTab container. */
  className?: string
  /** Custom className for the desktop RadioGroup. */
  radioGroupClassName?: string
  /** Custom className for the mobile Select trigger. */
  triggerClassName?: string
}

/**
 * Renders a radio-tab strip on `md+` screens and a select dropdown below it.
 */
function ResponsiveTabs({
  value,
  onValueChange,
  items,
  size = 'default',
  className,
  radioGroupClassName,
  triggerClassName,
}: ResponsiveTabsProps) {
  return (
    <>
      {/* Mobile: dropdown. The icon lives inside each SelectItem so Radix
          mirrors it (alongside the label) into the closed trigger. */}
      <div className='md:hidden'>
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger
            size={size === 'sm' ? 'sm' : 'default'}
            variant='outline'
            className={cn('w-full', triggerClassName)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => {
              const Icon = item.icon
              return (
                <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                  <span className='flex items-center gap-2'>
                    {Icon && <Icon className='size-4 shrink-0 text-muted-foreground' />}
                    {item.label}
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: tab strip */}
      <div className='hidden md:block'>
        <RadioTab
          value={value}
          onValueChange={onValueChange}
          size={size}
          radioGroupClassName={cn('w-full', radioGroupClassName)}
          className={cn('flex w-full border border-primary-200', className)}>
          {items.map((item) => {
            const Icon = item.icon
            return (
              <RadioTabItem
                key={item.value}
                value={item.value}
                size={size}
                disabled={item.disabled}
                tooltip={item.tooltip}>
                {Icon && <Icon />}
                {item.label}
              </RadioTabItem>
            )
          })}
        </RadioTab>
      </div>
    </>
  )
}

export { ResponsiveTabs }
