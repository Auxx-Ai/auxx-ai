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
import { ChevronDown, Clock, Webhook } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import {
  type ScheduledState,
  ScheduleEditor,
  scheduledConfigFromState,
  scheduledStateFromConfig,
} from '~/components/global/schedule'
import { api } from '~/trpc/react'
import {
  getConnectorDraftState,
  selectIsDirty,
  useConnectorDraftStore,
} from '../stores/connector-draft-store'
import { WebhookSignalInspector, WebhookSignalSection } from './webhook-signal-section'
import { WebhookSteeringSection } from './webhook-steering-section'

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
  const connectionId = connector.credentialId ?? null

  // App-trigger sync bridge (plans/data-connectors/v4): webhook mode is offered
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

  // Generic WebhookEndpoints can drive a webhook-sync stream too (app-less). If the org
  // has any, webhook mode is offered regardless of the connection's app/provider.
  const webhookEndpoints = api.webhookEndpoint.list.useQuery()
  const hasWebhookEndpoints = (webhookEndpoints.data?.length ?? 0) > 0

  const webhookSupported = appTriggerCapable || hasWebhookEndpoints

  // Webhook steering (signal picker + token mapping) only applies to generic-REST
  // connectors — app connectors have a fixed fetch that ignores webhook tokens (v7).
  const isGenericRest = connector.definitionKind !== 'app'

  // The window radio only makes sense when a stream declares which param carries the
  // backfill floor (templates do; bare generic-rest doesn't — Step 9 §1.2/§3.2). We
  // can't filter a param we don't know, so hide the choice otherwise.
  const streams = api.dataConnector.listStreams.useQuery({ id: connector.id })
  const supportsWindow = (streams.data ?? []).some(
    (s) => (s.requestConfig as { backfillWindow?: { sinceParam?: string } } | null)?.backfillWindow
  )

  // Behavior + schedule + backfill window all edit the one connector draft (the unified
  // saving model, plans/data-connectors/v4) — committed together by the floating save bar.
  const setSyncBehavior = useConnectorDraftStore((s) => s.setSyncBehavior)
  const setScheduleConfig = useConnectorDraftStore((s) => s.setScheduleConfig)
  const setBackfillWindowSpan = useConnectorDraftStore((s) => s.setBackfillWindowSpan)
  const setStreamValidity = useConnectorDraftStore((s) => s.setStreamValidity)
  const behavior = useConnectorDraftStore((s) => s.draft.syncBehavior) as SyncBehavior
  const windowSpan = useConnectorDraftStore(
    (s) =>
      ((s.draft.config as { backfillWindowSpan?: BackfillWindowSpan }).backfillWindowSpan ??
        'all') as BackfillWindowSpan
  )

  // The cadence editor holds local `ScheduledState` so an invalid intermediate edit stays
  // visible (the draft only ever holds a VALID config). Seeded from persisted config;
  // re-seeds on a server move only while the draft is clean (never clobbers an edit).
  const [schedule, setSchedule] = useState<ScheduledState>(() =>
    scheduledStateFromConfig(connector.scheduleConfig as Record<string, unknown> | null)
  )
  useEffect(() => {
    if (!selectIsDirty(getConnectorDraftState())) {
      setSchedule(
        scheduledStateFromConfig(connector.scheduleConfig as Record<string, unknown> | null)
      )
    }
  }, [connector.scheduleConfig])

  // A non-stream validity key — blocks commit while a "scheduled" behavior has no valid
  // cadence (replaces the old toast-and-bail). Cleared when the cadence becomes valid.
  const scheduleValidityKey = `schedule:${connector.id}`

  // Mirror a cadence edit into the draft. Reverting to the original writes the EXACT
  // snapshot config (no false-dirty from re-serialization, jsonb key reorder);
  // an invalid cadence blocks commit instead of persisting a broken schedule.
  const commitSchedule = (next: ScheduledState) => {
    setSchedule(next)
    const seedConfig = (getConnectorDraftState().snapshot?.scheduleConfig ?? null) as Record<
      string,
      unknown
    > | null
    if (JSON.stringify(next) === JSON.stringify(scheduledStateFromConfig(seedConfig))) {
      setScheduleConfig(seedConfig)
      setStreamValidity(scheduleValidityKey, true)
      return
    }
    const config = scheduledConfigFromState(next)
    setScheduleConfig((config as Record<string, unknown> | null) ?? null)
    setStreamValidity(scheduleValidityKey, !!config)
  }

  // Behavior change also resets the schedule config: 'scheduled' rebuilds it from the
  // current cadence, everything else clears it (manual / webhook never schedule).
  const changeBehavior = (next: SyncBehavior) => {
    setSyncBehavior(next)
    if (next === 'scheduled') {
      const config = scheduledConfigFromState(schedule)
      setScheduleConfig((config as Record<string, unknown> | null) ?? null)
      setStreamValidity(scheduleValidityKey, !!config)
    } else {
      setScheduleConfig(null)
      setStreamValidity(scheduleValidityKey, true)
    }
  }

  // Webhook mode on a generic-REST connector. The connector-level SIGNAL picker is
  // inlined directly in the Schedule body (no longer its own "Webhook trigger" section);
  // the per-stream STEERING stays a real section BELOW Schedule so its padding/borders
  // match the other top-level sections (v7).
  const showWebhookSignal = behavior === 'webhook' && isGenericRest
  // Steering lives on the connector page (never the stream window): WebhookSteeringSection
  // inlines a single stream's editor, or lists an expandable row per stream when there are many.
  const streamList = streams.data ?? []
  const showSteering = showWebhookSignal && streamList.length >= 1

  return (
    <>
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
                onValueChange={(v) => changeBehavior(v as SyncBehavior)}>
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
                onChange={(next: ScheduledState) => commitSchedule(next)}
              />
              <p className='text-xs text-muted-foreground'>
                Minimum cadence is {MIN_CONNECTOR_INTERVAL_MINUTES} minutes — connectors don’t sync
                more often than that.
              </p>
            </div>
          )}

          {/* Generic-REST webhook: the SIGNAL picker is inlined here, not its own section. */}
          {showWebhookSignal && <WebhookSignalSection connector={connector} />}

          {behavior === 'webhook' && !isGenericRest && (
            <div className='flex flex-col gap-3'>
              <EmptySection
                icon={<Webhook />}
                title='Webhook sync'
                description='Records update automatically as the provider sends webhook deliveries. Run the first full import with “Sync now”.'
              />
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
                onValueChange={(v) => setBackfillWindowSpan(v as BackfillWindowSpan)}
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

      {/* The bound signal's live inspector renders its own Section, so it sits here as a
          sibling below Schedule rather than nested in the inline signal picker. */}
      {showWebhookSignal && <WebhookSignalInspector connector={connector} />}

      {/* Steering on the connector page (inline for one stream, expandable rows for many).
          The connector-level WebhookSignalInspector above already shows the endpoint's
          deliveries, so the editors carry no inspector of their own. */}
      {showSteering && <WebhookSteeringSection connector={connector} streams={streamList} />}
    </>
  )
}
