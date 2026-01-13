// apps/web/src/components/fields/field-display.tsx
import type { ResourceField } from '@auxx/lib/resources/client'
import { DisplayOnlyProvider } from './display-only-provider'
import { DisplayField } from './displays/display-field'

/**
 * Props for FieldDisplay component
 */
interface FieldDisplayProps {
  /** Field definition */
  field: ResourceField
  /** Raw field value to display */
  value: any
}

/**
 * Standalone component for displaying field values without store integration.
 * Use this for read-only display of field values in contexts like:
 * - Preview panels
 * - Merge previews
 * - Read-only views
 * - Reports/exports
 *
 * @example
 * <FieldDisplay field={field} value="example@email.com" />
 */
export function FieldDisplay({ field, value }: FieldDisplayProps) {
  return (
    <DisplayOnlyProvider field={field} value={value}>
      <DisplayField />
    </DisplayOnlyProvider>
  )
}
