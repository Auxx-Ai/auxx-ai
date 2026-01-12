// apps/web/src/components/extensions/ui/record-widgets.tsx
'use client'

import { useSurfaces } from '~/lib/extensions/use-surfaces'
import { ExtensionWidget } from '~/components/extensions/extension-widget'

/**
 * Props for the RecordWidgets component.
 */
interface RecordWidgetsProps {
  recordId: string
  objectType: string
}

/**
 * Displays all extension widgets for a record.
 *
 * This component:
 * - Queries for all widgets that match the current record context
 * - Renders each widget using ExtensionWidget component
 * - Handles empty state when no widgets are available
 * - Groups widgets by extension
 *
 * - Uses useSurfaces to get filtered widget list
 * - Surface predicates filter widgets by context
 * - Each widget manages its own lifecycle
 *
 * @example Usage in a record detail page
 * ```tsx
 * function RecordDetailPage({ recordId }) {
 *   return (
 *     <div>
 *       <RecordHeader recordId={recordId} />
 *       <RecordWidgets recordId={recordId} objectType="ticket" />
 *     </div>
 *   )
 * }
 * ```
 */
export function RecordWidgets({ recordId, objectType }: RecordWidgetsProps) {
  // Get all widgets that should be shown for this record
  // The useSurfaces hook will filter based on surface predicates
  const widgets = useSurfaces({
    surfaceType: 'record-widget',
    context: { recordId, objectType },
  })

  if (widgets.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Extensions</h3>
      <div className="space-y-2">
        {widgets.map(({ surface, appId, appInstallationId, appTitle }) => (
          <div key={`${appId}:${surface.id}`} className="rounded-md border p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{appTitle}</span>
            </div>
            <ExtensionWidget
              appId={appId}
              appInstallationId={appInstallationId}
              widgetId={surface.id}
              surfaceProps={{ recordId, objectType }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
