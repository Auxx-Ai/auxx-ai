// apps/web/src/components/pickers/resource-picker/types.ts

import type { RefObject } from 'react'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'

/**
 * Props for ResourcePickerContent component
 */
export interface ResourcePickerContentProps {
  /** Currently selected resource IDs (entityDefinitionId) */
  value: string[]

  /** Called when selection changes */
  onChange: (selected: string[]) => void

  /** Multi-select mode (default: false — resource pickers are typically single-select) */
  multi?: boolean

  /** Called after selection in single-select mode */
  onSelectSingle?: (resourceId: string) => void

  /** Callback when arrow key capture state changes */
  onCaptureChange?: (capturing: boolean) => void

  /** Disabled state */
  disabled?: boolean

  /** Search placeholder */
  placeholder?: string

  /** Loading state */
  isLoading?: boolean

  /** Additional className */
  className?: string

  /** Resource IDs to exclude from the list */
  excludeIds?: string[]

  /** Filter: include system resources (default: true) */
  includeSystem?: boolean

  /** Filter: include custom resources (default: true) */
  includeCustom?: boolean
}

/**
 * Props for ResourcePicker component (popover wrapper)
 */
export interface ResourcePickerProps
  extends Omit<ResourcePickerContentProps, 'onCaptureChange' | 'className'> {
  /** Custom trigger element (if not provided, uses default button) */
  children?: React.ReactNode

  /** Popover open state (controlled) */
  open?: boolean

  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void

  /** External anchor ref - popover anchors to this element instead of trigger */
  anchorRef?: RefObject<HTMLElement | null>

  /** Default trigger: label when no items selected */
  emptyLabel?: string

  /** Popover alignment */
  align?: 'start' | 'center' | 'end'

  /** Popover side */
  side?: 'top' | 'bottom' | 'left' | 'right'

  /** Popover side offset */
  sideOffset?: number

  /** Additional className for popover content */
  contentClassName?: string

  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
}
