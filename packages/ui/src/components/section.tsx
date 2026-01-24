// packages/ui/src/components/section.tsx

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { Switch } from '@auxx/ui/components/switch'
import { TooltipExplanation } from '@auxx/ui/components/tooltip'

/**
 * Props for Section component
 */
export interface SectionProps {
  className?: string
  /** Icon to display before the title */
  icon?: React.ReactNode
  title: string
  titleClassName?: string
  /** Custom className for the CollapsibleContent wrapper */
  description?: string
  isRequired?: boolean
  children: React.ReactNode
  actions?: React.ReactNode
  showEnable?: boolean
  onEnableChange?: (checked: boolean) => void
  enabled?: boolean
  /** Controlled mode: external control of open state */
  open?: boolean
  /** Uncontrolled mode: initial open state (default: true) */
  initialOpen?: boolean
  /** Controls whether the section can be collapsed (default: true) */
  collapsible?: boolean
  /** Callback when section is opened/closed */
  onOpenChange?: (open: boolean) => void
  /** When true, disables interactive elements like the enable switch */
  isReadOnly?: boolean
}

/**
 * Collapsible section with title, description, and optional required indicator.
 * Supports both controlled and uncontrolled modes.
 */
export function Section({
  className,
  icon,
  title,
  titleClassName,
  description,
  isRequired = false,
  children,
  showEnable = false,
  actions,
  onEnableChange,
  enabled,
  open,
  initialOpen = true,
  collapsible = true,
  onOpenChange,
  isReadOnly = false,
}: SectionProps) {
  // Determine if component is in controlled mode
  const isControlled = open !== undefined

  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(initialOpen)

  // Use controlled value if provided, otherwise use internal state
  const currentOpen = isControlled ? open : internalOpen

  // Track previous enabled value to detect transitions
  const prevEnabledRef = useRef(enabled)

  // Auto-open when enabled changes from false to true (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled && showEnable && enabled && prevEnabledRef.current === false) {
      setInternalOpen(true)
    }
    prevEnabledRef.current = enabled
  }, [isControlled, showEnable, enabled])

  // Determine if we should show the collapse trigger
  const showCollapseTrigger = collapsible && (!showEnable || enabled)

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  return (
    <Collapsible
      data-slot="section-wrapper"
      open={!collapsible || (currentOpen && (typeof enabled === 'boolean' ? enabled : true))}
      onOpenChange={handleOpenChange}
      className={cn('group', className)}>
      <div
        data-slot="section"
        className={cn('p-3 pb-4 group-data-[state=closed]:pb-0 border-b flex flex-col min-h-0')}>
        <div className={cn('flex items-center justify-between pb-2')}>
            <div className="flex items-center gap-1">
              <div
                data-slot="section-title"
                className={cn(titleClassName, 'flex items-center text-xs font-medium uppercase')}>
                {icon && <span className="mr-1">{icon}</span>}
                <CollapsibleTrigger
                  disabled={!showCollapseTrigger}
                  className={cn(showCollapseTrigger && 'cursor-pointer')}>
                  <span className="mr-1">{title}</span>
                </CollapsibleTrigger>
                {isRequired && <span className="mr-1 text-xs font-semibold text-[#D92D20]">*</span>}
                {description && <TooltipExplanation text={description} className="text-primary-400" />}
              </div>
              <CollapsibleTrigger
                disabled={!showCollapseTrigger}
                className={cn(
                  'p-1 rounded hover:bg-muted transition-colors flex items-center',
                  showCollapseTrigger && 'cursor-pointer',
                  !showCollapseTrigger && 'invisible'
                )}>
                <ChevronDown
                  className="size-4 group-data-[state=closed]:hidden"
                  data-state="open"
                />
                <ChevronRight
                  className="size-4 group-data-[state=open]:hidden"
                  data-state="closed"
                />
              </CollapsibleTrigger>
            </div>
            <div className="flex items-center gap-2">
              {actions || null}
              {showEnable && (
                <Switch
                  size="sm"
                  checked={enabled}
                  disabled={isReadOnly}
                  onCheckedChange={onEnableChange}
                />
              )}
            </div>
          </div>
        <CollapsibleContent data-slot="section-content" className="flex flex-col">
          {children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

/**
 * Props for Field component
 */
export interface FieldProps {
  className?: string
  wrapperClassName?: string
  title: string
  description?: string
  isRequired?: boolean
  children?: React.ReactNode
  actions?: React.ReactNode
}

/**
 * A non-collapsible section component for grouping related UI elements.
 * Similar to Section but without collapse functionality.
 */
export function Field({
  className,
  wrapperClassName,
  title,
  description,
  isRequired = false,
  children,
  actions,
}: FieldProps) {
  return (
    <div className={cn(className)}>
      <div className="flex items-center justify-between">
        <div className="flex h-6 items-center gap-1">
          <div className="flex items-center gap-1 uppercase font-semibold text-primary-600 text-xs">
            <span>{title}</span>
            {isRequired && <span className="mr-1 text-xs font-semibold text-[#D92D20]">*</span>}
            {description && <TooltipExplanation text={description} className="text-primary-400" />}
          </div>
        </div>
        <div className="flex flex-row gap-1">{actions && actions}</div>
      </div>
      {children && <div className={cn('mt-1 flex flex-col', wrapperClassName)}>{children}</div>}
    </div>
  )
}

export default React.memo(Section)
