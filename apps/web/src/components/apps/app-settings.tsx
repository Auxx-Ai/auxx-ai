// apps/web/src/components/apps/app-settings.tsx
'use client'

import type { SettingsSchemaField } from '@auxx/services/app-settings/client'
import { Card } from '@auxx/ui/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { SlidersHorizontal } from 'lucide-react'
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
  const saveSettings = api.apps.saveSettings.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Settings saved successfully' })
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
