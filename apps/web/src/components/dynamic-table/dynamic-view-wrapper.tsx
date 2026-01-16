// apps/web/src/components/dynamic-table/dynamic-view-wrapper.tsx

/**
 * Feature flag wrapper for gradual migration to new architecture.
 *
 * Usage:
 * 1. Set NEXT_PUBLIC_NEW_TABLE_ARCH=true to enable new architecture globally
 * 2. Or use newArchitecture prop to enable per-table
 *
 * Example:
 * ```tsx
 * // Enable globally via env var
 * NEXT_PUBLIC_NEW_TABLE_ARCH=true
 *
 * // Enable for specific table
 * <DynamicView tableId="tickets" newArchitecture={true} ... />
 *
 * // Disable for specific table (override global flag)
 * <DynamicView tableId="legacy-table" newArchitecture={false} ... />
 * ```
 */

'use client'

import { DynamicView as DynamicViewLegacy } from './dynamic-view'
import { DynamicView as DynamicViewNew } from './dynamic-view-new'
import type { DynamicTableProps } from './types'

// Global feature flag from environment
const GLOBAL_NEW_ARCH_ENABLED = process.env.NEXT_PUBLIC_NEW_TABLE_ARCH === 'true'

interface DynamicViewWrapperProps<TData extends object = object> extends DynamicTableProps<TData> {
  /**
   * Enable new architecture for this table instance.
   * Overrides global flag if provided.
   */
  newArchitecture?: boolean

  /**
   * @deprecated Use newArchitecture instead
   */
  useNewArchitecture?: boolean
}

/**
 * Wrapper component that routes to old or new implementation based on feature flag.
 */
export function DynamicView<TData extends object = object>(
  props: DynamicViewWrapperProps<TData>
) {
  const { newArchitecture, useNewArchitecture, ...restProps } = props

  // Determine which implementation to use
  // Priority: prop override > global env flag > default (legacy)
  const shouldUseNew = newArchitecture ?? useNewArchitecture ?? GLOBAL_NEW_ARCH_ENABLED

  if (shouldUseNew) {
    // Log which implementation we're using (only in development)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DynamicView] Using NEW architecture for table: ${props.tableId}`)
    }
    return <DynamicViewNew {...restProps} />
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DynamicView] Using LEGACY architecture for table: ${props.tableId}`)
  }
  return <DynamicViewLegacy {...restProps} />
}

// Re-export types
export type { DynamicTableProps, DynamicViewWrapperProps }

// Export both implementations for direct usage if needed
export { DynamicViewLegacy, DynamicViewNew }
