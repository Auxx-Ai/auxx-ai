// apps/web/src/components/fields/displays/display-json.tsx

import { Badge } from '@auxx/ui/components/badge'

/**
 * DisplayJson
 * Display component for JSON field values.
 * Shows a simple badge - JSON content is not displayed to users.
 */
export function DisplayJson() {
  return <Badge variant='secondary'>JSON</Badge>
}
