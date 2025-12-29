// apps/web/src/app/(protected)/app/examples/apps/page.tsx

'use client'

import { useSurfaces } from '~/lib/extensions/use-surfaces'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'
import { Loader2 } from 'lucide-react'

export default function ExtensionAppsExamplePage() {
  // Get AppStore to trigger surfaces
  const { store } = useInternalAppsContext()

  // Get all surfaces from all installed extensions with loading state
  const { data: allSurfaces, isLoading, isError } = useSurfaces()

  // Show loading state
  if (isLoading) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading extensions...</span>
        </div>
      </div>
    )
  }

  // Show error state
  if (isError) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive text-center">
              Failed to load extensions. Please try refreshing the page.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }
  console.log(allSurfaces)
  // Extract record actions grouped by app
  const actionsByApp = Array.from(allSurfaces.entries()).map(([key, surfacesData]) => {
    const [appId, appInstallationId] = key.split(':')
    return {
      appId: appId!,
      appInstallationId: appInstallationId!,
      recordActions: surfacesData.surfaces['record-action'] || [],
      bulkActions: surfacesData.surfaces['bulk-record-action'] || [],
      widgets: surfacesData.surfaces['record-widget'] || [],
    }
  })

  const handleTriggerAction = async (action: any, appId: string, appInstallationId: string) => {
    try {
      console.log(`[Examples] Triggering action: ${action.id} from app: ${appId}`)

      // Trigger the action via AppStore (sends message to iframe)
      await store.triggerSurface({
        appId,
        appInstallationId,
        surfaceType: 'record-action',
        surfaceId: action.id,
        payload: {
          recordId: 'example-record-123',
          recordType: 'contact',
          metadata: {
            source: 'extension-examples-page',
          },
        },
      })

      console.log(`[Examples] Action ${action.id} completed successfully`)
    } catch (error) {
      console.error(`[Examples] Action ${action.id} failed:`, error)
    }
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Extension Examples - Apps</h1>
        <p className="text-muted-foreground">
          Test installed extension actions and surfaces. Click any action to trigger it with mock
          data.
        </p>
      </div>

      {actionsByApp.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No extensions installed. Install an extension to see its surfaces here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {actionsByApp.map(({ appId, appInstallationId, recordActions, bulkActions, widgets }) => {
            const totalSurfaces = recordActions.length + bulkActions.length + widgets.length

            if (totalSurfaces === 0) return null

            return (
              <Card key={appInstallationId}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        App: {appId}
                        <Badge variant="secondary">{totalSurfaces} surfaces</Badge>
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Installation ID: {appInstallationId}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Record Actions */}
                  {recordActions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3">
                        Record Actions ({recordActions.length})
                      </h3>
                      <div className="flex flex-col gap-2">
                        {recordActions.map((action) => (
                          <Button
                            key={action.id}
                            variant="outline"
                            onClick={() => handleTriggerAction(action, appId, appInstallationId)}
                            className="justify-start">
                            {action.icon && <span className="mr-2">{action.icon}</span>}
                            {action.label || action.id}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Bulk Actions */}
                  {bulkActions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3">
                        Bulk Actions ({bulkActions.length})
                      </h3>
                      <div className="flex flex-col gap-2">
                        {bulkActions.map((action) => (
                          <Button
                            key={action.id}
                            variant="outline"
                            onClick={() => handleTriggerAction(action, appId)}
                            className="justify-start">
                            {action.label || action.id}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Widgets */}
                  {widgets.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3">Widgets ({widgets.length})</h3>
                      <div className="text-sm text-muted-foreground">
                        {widgets.map((widget) => (
                          <div key={widget.id} className="py-1">
                            • {widget.label || widget.id}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
