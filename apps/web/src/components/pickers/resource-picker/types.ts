// apps/web/src/components/pickers/resource-picker/types.ts

import type React from 'react'
import type { FieldType } from '@auxx/database/types'
import type { FieldReference, ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { NavigationItem } from '@auxx/ui/components/command'

/**
 * Flexible exclude filter for fields.
 * - FieldType enum: excludes all fields of that type (e.g., FieldType.RELATIONSHIP)
 * - entityDefinitionId: excludes all fields from that entity
 * - ResourceFieldId: excludes specific field (format: "entityDefId:fieldId")
 */
export type ExcludeFilter = FieldType | string

/**
 * Props for ResourcePickerContent (inner content without popover)
 */
export interface ResourcePickerContentProps {
  /** Entity definition ID to show fields for */
  entityDefinitionId: string

  /** Already selected field references */
  fieldReferences?: FieldReference[]

  /** Fields to exclude from display */
  excludeFields?: ExcludeFilter[]

  /** Callback when a field is selected */
  onSelect: (fieldReference: FieldReference, field: ResourceField) => void

  /** Selection mode */
  mode?: 'single' | 'multi'

  /** Close popover after selection (typically true for single mode) */
  closeOnSelect?: boolean

  /** Callback to close the picker (used with closeOnSelect) */
  onClose?: () => void

  /** Optional: Show "Create field" button */
  onCreateField?: () => void

  /** Optional: Search placeholder */
  searchPlaceholder?: string
}

/**
 * Props for ResourcePicker (with popover wrapper)
 */
export interface ResourcePickerProps extends Omit<ResourcePickerContentProps, 'onClose'> {
  /** Controlled open state */
  open?: boolean

  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void

  /** Trigger element */
  trigger?: React.ReactNode

  /** Popover alignment */
  align?: 'start' | 'center' | 'end'

  /** Popover width */
  width?: number | string
}

/**
 * Navigation item for CommandNavigation stack.
 * Tracks the path through relationships.
 */
export interface ResourcePickerNavigationItem extends NavigationItem {
  /** Unique navigation ID */
  id: string
  /** Display label (field label) */
  label: string
  /** The relationship field that was clicked */
  resourceFieldId: ResourceFieldId
  /** Target entity we navigated into */
  targetEntityDefinitionId: string
}

/**
 * External navigation interface for nested usage.
 * Allows ResourcePickerInnerContent to use parent's navigation context.
 */
export interface ExternalNavigation {
  /** Push a navigation item onto the stack */
  push: (item: ResourcePickerNavigationItem) => void
  /** Pop the current item from the stack */
  pop: () => void
  /** Current navigation stack */
  stack: ResourcePickerNavigationItem[]
  /** Current navigation item (top of stack) */
  current: ResourcePickerNavigationItem | null
  /** Whether at root of navigation */
  isAtRoot: boolean
}

/**
 * Props for ResourcePickerInnerContent (without CommandNavigation wrapper).
 * Used for nested usage within an existing CommandNavigation context.
 */
export interface ResourcePickerInnerContentProps extends ResourcePickerContentProps {
  /** External navigation control (for nested usage) */
  externalNavigation?: ExternalNavigation

  /** Additional content rendered at end of CommandList (e.g., Functions group for CALC) */
  renderAdditionalContent?: (search: string) => React.ReactNode

  /** Show breadcrumb in standalone mode (default: true) */
  showBreadcrumb?: boolean
}

/**
 * Props for FieldItem component
 */
export interface FieldItemProps {
  /** The field to display */
  field: ResourceField

  /** Whether this field is selected */
  isSelected?: boolean

  /** Whether this is a relationship that can be drilled into */
  canDrillDown?: boolean

  /** Callback when field is selected */
  onSelect: () => void

  /** Callback when drilling into relationship */
  onDrillDown?: () => void
}
