// apps/web/src/app/(protected)/app/settings/channels/_components/calendar-sync-toggle.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { useOAuthPopup } from '~/hooks/use-oauth-popup'
import { api } from '~/trpc/react'

interface CalendarSyncToggleProps {
  integrationId: string
  /** Viewer may not manage this channel (member on a shared channel) — render read-only. */
  disabled?: boolean
}

/**
 * Calendar sync section for Google integrations.
 * Matches the section pattern used in integration-routing.
 */
export function CalendarSyncToggle({ integrationId, disabled }: CalendarSyncToggleProps) {
  const utils = api.useUtils()
  const { data, isLoading } = api.calendar.getSyncStatus.useQuery()

  const enableSync = api.calendar.enableSync.useMutation({
    onError: (error) => {
      toastError({ title: 'Unable to enable calendar sync', description: error.message })
    },
  })
  const disableSync = api.calendar.disableSync.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.calendar.getSyncStatus.invalidate(),
        utils.channel.list.invalidate(),
      ])
      toastSuccess({ title: 'Calendar sync disabled' })
    },
    onError: (error) => {
      toastError({ title: 'Unable to disable calendar sync', description: error.message })
    },
  })
  const triggerSync = api.calendar.triggerSync.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.calendar.getSyncStatus.invalidate(),
        utils.channel.list.invalidate(),
      ])
      toastSuccess({ title: 'Calendar sync queued' })
    },
    onError: (error) => {
      toastError({ title: 'Unable to trigger calendar sync', description: error.message })
    },
  })

  // Incremental calendar-scope grant — new scopes always need consent, so this skips the
  // silent-refresh attempt `useChannelReconnect` tries and goes straight to a popup with the
  // authorize URL `calendar.enableSync` already builds (with the extra `scope_add` param). The
  // generic `useConnectFlow` target doesn't have a seam for that extra scope param today, so this
  // stays a thin bespoke popup call instead — see plans/channels/v3/README.md Open questions.
  const { open: openCalendarPopup, pending: calendarPopupPending } = useOAuthPopup()

  const integrationStatus = data?.integrations.find(
    (integration) => integration.id === integrationId
  )
  const isEnabled = integrationStatus?.calendarSyncEnabled === true

  const handleCheckedChange = async (checked: boolean) => {
    if (checked) {
      const result = await enableSync.mutateAsync({ integrationId })
      if (result.authUrl) {
        openCalendarPopup({
          popupUrl: `${result.authUrl}&mode=popup`,
          fallbackUrl: result.authUrl,
          channelName: 'oauth-app-connect',
          verify: async () => {
            const status = await utils.calendar.getSyncStatus.fetch(undefined, { staleTime: 0 })
            const integration = status.integrations.find((i) => i.id === integrationId)
            return integration?.calendarSyncEnabled ? true : null
          },
          onDone: (ok) => {
            void utils.calendar.getSyncStatus.invalidate()
            if (ok) void utils.channel.list.invalidate()
          },
        })
      }
      return
    }

    await disableSync.mutateAsync({ integrationId })
  }

  const handleManualSync = async () => {
    await triggerSync.mutateAsync({ integrationId })
  }

  return (
    <SettingsSection
      icon={CalendarDays}
      title='Calendar Sync'
      description='Sync Google Calendar events, meeting links, and CRM-ready Meeting records.'
      action={
        isEnabled ? (
          <Button
            variant='outline'
            size='sm'
            onClick={handleManualSync}
            disabled={disabled || triggerSync.isPending}
            loading={triggerSync.isPending}
            loadingText='Syncing...'>
            <RefreshCw />
            Sync now
          </Button>
        ) : undefined
      }>
      <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
        <div className='flex items-center gap-3'>
          <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0'>
            <CalendarDays className='size-4' />
          </div>
          <div className='flex flex-col'>
            <span className='text-sm font-medium'>
              {isLoading ? 'Loading...' : isEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <span className='text-xs text-muted-foreground'>
              {integrationStatus?.lastCalendarSyncAt
                ? `Last synced ${new Date(integrationStatus.lastCalendarSyncAt).toLocaleString()}`
                : 'Grant calendar access to keep meetings in sync'}
            </span>
            {integrationStatus?.requiresReauth && integrationStatus.lastAuthError && (
              <span className='text-xs text-destructive'>{integrationStatus.lastAuthError}</span>
            )}
          </div>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={handleCheckedChange}
          disabled={
            disabled || enableSync.isPending || disableSync.isPending || calendarPopupPending
          }
        />
      </div>
    </SettingsSection>
  )
}
