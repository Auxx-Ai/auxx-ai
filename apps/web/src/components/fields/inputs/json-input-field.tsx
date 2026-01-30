// apps/web/src/components/fields/inputs/json-input-field.tsx

import { Badge } from '@auxx/ui/components/badge'

/**
 * JsonInputField
 * Displays a non-editable JSON badge.
 * JSON fields are system-managed and not user-editable.
 */
export function JsonInputField() {
  return <Badge variant="secondary">JSON</Badge>
}
