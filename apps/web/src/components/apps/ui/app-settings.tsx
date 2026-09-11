// apps/web/src/components/apps/ui/app-settings.tsx
'use client'

import type { SettingsSchemaField } from '@auxx/services/app-settings/client'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { SlidersHorizontal } from 'lucide-react'
import { useOptionalMessageClient } from '~/components/apps/runtime/hooks/use-optional-message-client'
import { api } from '~/trpc/react'
import { SettingsFormRenderer } from './settings-form-renderer'

/**
 * Props for AppSettings component
 */
interface AppSettingsProps {
  app: any
  installationType: 'development' | 'production'
  currentSettings: Record<string, any>
  schema: Record<string, SettingsSchemaField>
}

/**
 * AppSettings component
 * Renders the app's settings form with Zod validation
 */
export default function AppSettings({
  app,
  installationType,
  currentSettings,
  schema,
}: AppSettingsProps) {
  // The app's runtime iframe, if one is already up. Pooled per installation in
  // `AppStore`, so it commonly outlives the page the user is on.
  const { messageClient } = useOptionalMessageClient({
    appId: app?.app?.id,
    appInstallationId: app?.installation?.id,
  })

  const saveSettings = api.apps.saveSettings.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Settings saved successfully' })

      // Tell the app its settings moved, so anything it derived from them can be
      // re-read. The app runtime iframe is long-lived and pooled per
      // installation, so module state inside an app survives navigation around
      // the host: without this an app caching anything settings-derived serves a
      // stale answer until a full page reload. That shipped once already, as a
      // workflow panel still offering read-only operations after writes were
      // enabled.
      //
      // Fire-and-forget on purpose. No iframe running means nothing to
      // invalidate, because the app will read settings fresh when it next
      // starts, and a failed notification must never fail a save that already
      // committed.
      void messageClient
        ?.sendRequest('host-event', {
          name: 'settings-changed',
          payload: { installationType },
        })
        .catch(() => {})
    },
    onError: (error) => {
      toastError({
        title: 'Failed to save settings',
        description: error.message,
      })
    },
  })

  const handleSubmit = async (values: Record<string, any>) => {
    await saveSettings.mutateAsync({
      appSlug: app.app.slug,
      installationType,
      settings: values,
    })
  }

  return (
    <div className='space-y-6'>
      {Object.keys(schema).length === 0 ? (
        <div className='flex flex-col items-center justify-center flex-1 overflow-y-auto py-12'>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <SlidersHorizontal />
              </EmptyMedia>
              <EmptyTitle>No settings available</EmptyTitle>
              <EmptyDescription>
                The app developer hasn't defined any settings yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <SettingsFormRenderer
          schema={schema}
          defaultValues={currentSettings}
          onSubmit={handleSubmit}
          isPending={saveSettings.isPending}
        />
      )}
    </div>
  )
}
