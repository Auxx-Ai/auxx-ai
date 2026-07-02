// apps/web/src/components/pickers/resource-field-picker/types.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import type React from 'react'
import type { RefObject } from 'react'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
import type { ExcludeFilter } from '../field-picker'

/**
 * Props for ResourceFieldPickerContent — the unified resource → field picker
 * content (single `CommandNavigation` stack, no popover). The root level lists
 * resources; drilling into one delegates to the shared field picker with
 * relationship drill-down. Selecting a field emits its entity-scoped
 * `ResourceFieldId` (or a `FieldPath` for a relationship hop).
 */
export interface ResourceFieldPickerContentProps {
  /** Currently selected field reference (drives highlight + trigger display). */
  value?: FieldReference

  /** Called when a field is selected. Emits the entity-scoped `FieldReference`. */
  onSelect: (fieldReference: FieldReference, field: ResourceField) => void

  /** Close the picker after selection (default true). */
  closeOnSelect?: boolean

  /** Callback to close the picker (wired by the popover wrapper). */
  onClose?: () => void

  /** Fields to exclude within a resource. */
  excludeFields?: ExcludeFilter[]

  /**
   * Predicate applied after excludeFields/active checks — return false to hide
   * a field. Mirrors {@link FieldPickerContentProps.filterField}.
   */
  filterField?: (field: ResourceField) => boolean

  /** Suppress relationship drill-down (relationship rows become select-only). */
  disableDrillDown?: boolean

  /** Resource IDs to exclude from the root list. */
  excludeResourceIds?: string[]

  /** Include system resources in the root list (default true). */
  includeSystem?: boolean

  /** Include custom resources in the root list (default true). */
  includeCustom?: boolean

  /** Only offer resources backed by an `EntityDefinition` row (default false). */
  entityDefinedOnly?: boolean

  /** Placeholder for the resource-root search input. */
  resourceSearchPlaceholder?: string

  /** Placeholder for the field search input. */
  fieldSearchPlaceholder?: string

  /** Additional className for the outer `Command` shell. */
  className?: string
}

/**
 * Props for ResourceFieldPicker (popover wrapper). Mirrors {@link ResourcePickerProps}.
 */
export interface ResourceFieldPickerProps extends ResourceFieldPickerContentProps {
  /** Custom trigger element (if not provided, uses the default `PickerTrigger`). */
  children?: React.ReactNode

  /** Popover open state (controlled). */
  open?: boolean

  /** Callback when open state changes. */
  onOpenChange?: (open: boolean) => void

  /** External anchor ref — popover anchors to this element instead of the trigger. */
  anchorRef?: RefObject<HTMLElement | null>

  /** Default trigger label when no field is selected. */
  emptyLabel?: string

  /** Popover alignment. */
  align?: 'start' | 'center' | 'end'

  /** Popover side. */
  side?: 'top' | 'bottom' | 'left' | 'right'

  /** Popover side offset. */
  sideOffset?: number

  /** Additional className for the popover content. */
  contentClassName?: string

  /** Trigger customization options. */
  triggerProps?: PickerTriggerOptions

  /** Disabled state. */
  disabled?: boolean
}
