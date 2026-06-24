// apps/web/src/components/data-connectors/ui/schedule-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { EmptySection, Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { ChevronDown, Clock, Webhook } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { ConnectionWebhookTestSection } from '~/components/connections/triggers/connection-webhook-test-section'
import {
  type ScheduledState,
  ScheduleEditor,
  scheduledConfigFromState,
  scheduledStateFromConfig,
} from '~/components/global/schedule'
import { api } from '~/trpc/react'
import { useBufferedConfig } from '../hooks/use-buffered-config'
import { useRegisterSaver } from '../hooks/use-connector-edits'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

type SyncBehavior = 'manual' | 'scheduled' | 'webhook'
type BackfillWindowSpan = 'all' | 'last_90_days' | 'last_12_months'

// Mirrors MIN_CONNECTOR_INTERVAL_MINUTES in the data-connectors tRPC router.
// Hardcoded here to keep this client component free of the server-only barrel.
const MIN_CONNECTOR_INTERVAL_MINUTES = 15

const WINDOW_OPTIONS: Array<{ value: BackfillWindowSpan; label: string }> = [
  { value: 'all', label: 'Import all history' },
  { value: 'last_12_months', label: 'Last 12 months' },
  { value: 'last_90_days', label: 'Last 90 days' },
]

interface ScheduleSectionProps {
  connector: Connector
}

/**
 * Schedule section — a header dropdown over the connector's single
 * `syncBehavior` (Manual · Scheduled · Webhook), NOT a list of triggers (05 §5).
 * Scheduled reveals the shared `ScheduleEditor` round-tripping `scheduleConfig`;
 * the minute floor is coarser than workflows ({@link MIN_CONNECTOR_INTERVAL_MINUTES}).
 * Webhook is offered only when the connection's provider has a webhook spec; selecting
 * it subscribes the connection to the provider's full topic set (the save path sends
 * `syncBehavior: 'webhook'` + `scheduleConfig: null`, and `updateConnector` reconciles).
 */
export function ScheduleSection({ connector }: ScheduleSectionProps) {
  const utils = api.useUtils()

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not save schedule', description: e.message }),
  })

  // Webhook mode is gated on the connection's provider having a webhook spec. `topics === null`
  // ⇒ no spec ⇒ don't offer the option. A connector subscribes to the provider's FULL topic set
  // (the sink drops actions for unmapped streams), so there's no per-topic config — the topic
  // picker below only scopes the live delivery inspector.
  const connectionId = connector.credentialId ?? null
  const webhookTopics = api.connections.webhookTopics.useQuery(
    { connectionId: connectionId ?? '' },
    { enabled: !!connectionId }
  )
  const topics = webhookTopics.data?.topics ?? null

  // App-trigger sync bridge (plans/data-connectors/v4): webhook mode is ALSO offered
  // when the connection's app declares webhook triggers — that's the path real app
  // connections take (the legacy provider-spec gate above matches none of them). The
  // per-stream trigger binding lives in the stream config, not here.
  const { appInstallations, appConnections } = useAppsContext()
  const appTriggerCapable = (() => {
    const installationId =
      connector.appInstallationId ??
      appConnections.find((c) => c.id === connectionId)?.appInstallationId ??
      null
    if (!installationId) return false
    const inst = appInstallations.find((i) => i.installationId === installationId)
    return (inst?.workflowTriggers?.length ?? inst?.agentTriggers?.length ?? 0) > 0
  })()

  const webhookSupported =
    (!!connectionId && Array.isArray(topics) && topics.length > 0) || appTriggerCapable

  const [inspectorTopic, setInspectorTopic] = useState<string>()
  useEffect(() => {
    if (topics && topics.length > 0 && (!inspectorTopic || !topics.includes(inspectorTopic))) {
      setInspectorTopic(topics[0])
    }
  }, [topics, inspectorTopic])

  // The window radio only makes sense when a stream declares which param carries the
  // backfill floor (templates do; bare generic-rest doesn't — Step 9 §1.2/§3.2). We
  // can't filter a param we don't know, so hide the choice otherwise.
  const streams = api.dataConnector.listStreams.useQuery({ id: connector.id })
  const supportsWindow = (streams.data ?? []).some(
    (s) => (s.requestConfig as { backfillWindow?: { sinceParam?: string } } | null)?.backfillWindow
  )
  const persistedSpan = ((connector.config as { backfillWindowSpan?: BackfillWindowSpan } | null)
    ?.backfillWindowSpan ?? 'all') as BackfillWindowSpan

  // Behavior + schedule + backfill window are one buffered draft behind a single Save
  // — flip mode to 'auto' for autosave (plan §6). All edits dirty the same draft.
  const draft = useBufferedConfig(
    {
      behavior: (connector.syncBehavior as SyncBehavior) ?? 'manual',
      schedule: scheduledStateFromConfig(
        connector.scheduleConfig as Record<string, unknown> | null
      ),
      windowSpan: persistedSpan,
    },
    (value) => {
      // `update` replaces config wholesale, so merge the span into the existing
      // config — and only send it when it changed, to avoid clobbering a concurrent
      // config edit on a pure schedule save.
      const windowChanged = value.windowSpan !== persistedSpan
      const configPatch = windowChanged
        ? {
            config: {
              ...((connector.config as Record<string, unknown> | null) ?? {}),
              backfillWindowSpan: value.windowSpan,
            },
          }
        : {}
      if (value.behavior === 'scheduled') {
        const config = scheduledConfigFromState(value.schedule)
        if (!config) {
          toastError({
            title: 'Invalid schedule',
            description: 'Pick a valid cadence before saving.',
          })
          return
        }
        return update.mutateAsync({
          id: connector.id,
          syncBehavior: 'scheduled',
          scheduleConfig: config,
          ...configPatch,
        })
      }
      return update.mutateAsync({
        id: connector.id,
        syncBehavior: value.behavior,
        scheduleConfig: null,
        ...configPatch,
      })
    },
    { mode: 'manual' }
  )
  const { behavior, schedule, windowSpan } = draft.value

  // Feeds the connector-wide save bar; no per-section Save button.
  useRegisterSaver('schedule', draft.isDirty, update.isPending, draft.commit)

  return (
    <Section
      title='Schedule'
      icon={<Clock className='size-4' />}
      initialOpen
      collapsible={false}
      description='How often this connector syncs.'
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='xs'>
              {behavior === 'webhook'
                ? 'Webhook'
                : behavior === 'scheduled'
                  ? 'Scheduled'
                  : 'Manual'}
              <ChevronDown className='size-3' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuRadioGroup
              value={behavior}
              onValueChange={(v) => draft.set({ ...draft.value, behavior: v as SyncBehavior })}>
              <DropdownMenuRadioItem value='manual' indicator='check'>
                Manual
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value='scheduled' indicator='check'>
                Scheduled
              </DropdownMenuRadioItem>
              {webhookSupported && (
                <DropdownMenuRadioItem value='webhook' indicator='check'>
                  Webhook
                </DropdownMenuRadioItem>
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }>
      <div className='flex flex-col gap-4 px-1'>
        {behavior === 'manual' && (
          <EmptySection
            icon={<Clock />}
            title='Manual sync'
            description='Sync runs from the “Sync now” action in the header.'
          />
        )}

        {behavior === 'scheduled' && (
          <div className='flex flex-col gap-3'>
            <ScheduleEditor
              value={schedule}
              minMinutes={MIN_CONNECTOR_INTERVAL_MINUTES}
              onChange={(next: ScheduledState) => draft.set({ ...draft.value, schedule: next })}
            />
            <p className='text-xs text-muted-foreground'>
              Minimum cadence is {MIN_CONNECTOR_INTERVAL_MINUTES} minutes — connectors don’t sync
              more often than that.
            </p>
          </div>
        )}

        {behavior === 'webhook' && (
          <div className='flex flex-col gap-3'>
            <EmptySection
              icon={<Webhook />}
              title='Webhook sync'
              description='Records update automatically as the provider sends webhook deliveries. Run the first full import with “Sync now”.'
            />

            {topics && topics.length > 0 && (
              <div className='flex flex-col gap-1 text-xs text-muted-foreground'>
                <span className='font-medium text-foreground'>Subscribed events</span>
                {topics.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}

            {connectionId && topics && topics.length > 0 && inspectorTopic && (
              <div className='flex flex-col gap-2 border-t pt-4'>
                <Select value={inspectorTopic} onValueChange={setInspectorTopic}>
                  <SelectTrigger size='sm' className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {topics.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ConnectionWebhookTestSection connectionId={connectionId} topic={inspectorTopic} />
              </div>
            )}
          </div>
        )}

        {supportsWindow && (
          <div className='flex flex-col gap-2 border-t pt-4'>
            <div className='text-sm font-medium'>How much history to import</div>
            <p className='text-xs text-muted-foreground'>
              Applies to the first full import. Changing this takes effect on the next import.
            </p>
            <RadioGroup
              value={windowSpan}
              onValueChange={(v) =>
                draft.set({ ...draft.value, windowSpan: v as BackfillWindowSpan })
              }
              className='gap-2 pt-1'>
              {WINDOW_OPTIONS.map((opt) => (
                <div key={opt.value} className='flex items-center gap-2'>
                  <RadioGroupItem value={opt.value} id={`window-${opt.value}`} />
                  <Label htmlFor={`window-${opt.value}`} className='cursor-pointer font-normal'>
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}
      </div>
    </Section>
  )
}
