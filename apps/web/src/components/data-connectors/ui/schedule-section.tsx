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
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { EmptySection, Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
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

type SweepFrequency = 'off' | 'daily' | 'weekly'

interface SweepCadence {
  frequency: SweepFrequency
  hour: number
}

// The nightly-check default when a webhook connector has no scheduleConfig (null) —
// matches SWEEP_CRON ('0 3 * * *') in data-connector-scheduler.ts.
const DEFAULT_SWEEP_HOUR = 3

/**
 * Parse a webhook-mode `scheduleConfig` into the Nightly-check Selects' state (Phase 6):
 * `null` → nightly default (daily 3am); `{ triggerInterval: 'off' }` → off; a
 * `0 H * * D` cron → daily (`D === '*'`) or weekly (`D === '0'`) at hour H. Anything
 * unrecognized falls back to the daily default rather than throwing.
 */
function parseSweepCadence(config: Record<string, unknown> | null | undefined): SweepCadence {
  if (!config) return { frequency: 'daily', hour: DEFAULT_SWEEP_HOUR }
  if (config.triggerInterval === 'off') return { frequency: 'off', hour: DEFAULT_SWEEP_HOUR }
  const cron = typeof config.customCron === 'string' ? config.customCron : ''
  const parts = cron.trim().split(/\s+/)
  if (parts.length === 5) {
    const hour = Number(parts[1])
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      return { frequency: parts[4] === '*' ? 'daily' : 'weekly', hour }
    }
  }
  return { frequency: 'daily', hour: DEFAULT_SWEEP_HOUR }
}

/** Serialize a Nightly-check selection into the `scheduleConfig` blob (weekly = Sunday). */
function sweepCadenceToConfig(freq: SweepFrequency, hour: number): Record<string, unknown> {
  if (freq === 'off') return { triggerInterval: 'off', timeBetweenTriggers: {} }
  const dayOfWeek = freq === 'weekly' ? '0' : '*'
  return {
    triggerInterval: 'custom',
    customCron: `0 ${hour} * * ${dayOfWeek}`,
    timeBetweenTriggers: {},
  }
}

/** Hour-of-day as a `3:00 AM` label. */
function formatHourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:00 ${period}`
}

/**
 * The webhook-mode "Nightly check" block (Phase 6): a Frequency (off/daily/weekly)
 * + Time (hour-of-day) pair writing the sweep cadence into the connector draft, plus a
 * read-only "Last check" stamp from the most recent `sweep`-triggered run. Reverting to
 * the persisted cadence writes the EXACT snapshot value so it doesn't read as dirty.
 */
function SweepCadenceSection({ connector }: { connector: Connector }) {
  const setScheduleConfig = useConnectorDraftStore((s) => s.setScheduleConfig)
  const scheduleConfig = useConnectorDraftStore((s) => s.draft.scheduleConfig)
  const cadence = parseSweepCadence(scheduleConfig)

  const apply = (frequency: SweepFrequency, hour: number) => {
    const seed = (getConnectorDraftState().snapshot?.scheduleConfig ?? null) as Record<
      string,
      unknown
    > | null
    const seedCadence = parseSweepCadence(seed)
    // Selecting the persisted cadence again → write the untouched snapshot (avoids a
    // false-dirty diff, e.g. null-default vs an explicit `0 3 * * *`).
    if (seedCadence.frequency === frequency && (frequency === 'off' || seedCadence.hour === hour)) {
      setScheduleConfig(seed)
      return
    }
    setScheduleConfig(sweepCadenceToConfig(frequency, hour))
  }

  // listRuns is newest-first (desc startedAt), so the first sweep row is the latest.
  const runs = api.dataConnector.listRuns.useQuery({ id: connector.id, limit: 50 })
  const lastSweep = runs.data?.find((r) => r.trigger === 'sweep') ?? null

  return (
    <div className='flex flex-col gap-3 border-t pt-4'>
      <div className='flex flex-col gap-1'>
        <div className='text-sm font-medium'>Nightly check</div>
        <p className='text-xs text-muted-foreground'>
          Re-verifies your data in case a webhook delivery was missed.
        </p>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={cadence.frequency}
          onValueChange={(v) => apply(v as SweepFrequency, cadence.hour)}>
          <SelectTrigger size='sm' className='w-32'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='off'>Off</SelectItem>
            <SelectItem value='daily'>Daily</SelectItem>
            <SelectItem value='weekly'>Weekly</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={String(cadence.hour)}
          onValueChange={(v) => apply(cadence.frequency, Number(v))}
          disabled={cadence.frequency === 'off'}>
          <SelectTrigger size='sm' className='w-28'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 24 }, (_, h) => (
              <SelectItem key={h} value={String(h)}>
                {formatHourLabel(h)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {cadence.frequency === 'off' && (
        <p className='text-xs text-amber-600'>
          Missed webhook deliveries and deletions will not be corrected automatically.
        </p>
      )}
      {lastSweep && (
        <LastUpdated
          timestamp={new Date(lastSweep.startedAt)}
          prefix='Last check: '
          className='text-xs text-muted-foreground'
        />
      )}
    </div>
  )
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
    return (
      (inst?.workflowTriggers?.length ?? inst?.agentTriggers?.length ?? 0) > 0 ||
      Boolean(inst?.dataConnectors?.[0]?.webhookTrigger)
    )
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
  // current cadence; 'webhook' clears it to the nightly-default sweep (the Nightly-check
  // Selects below write a real config on edit); 'manual' clears it (never schedules).
  const changeBehavior = (next: SyncBehavior) => {
    setSyncBehavior(next)
    if (next === 'scheduled') {
      const config = scheduledConfigFromState(schedule)
      setScheduleConfig((config as Record<string, unknown> | null) ?? null)
      setStreamValidity(scheduleValidityKey, !!config)
    } else if (next === 'webhook') {
      // Webhook mode: scheduleConfig now means the SWEEP cadence; null = nightly default.
      setScheduleConfig(null)
      setStreamValidity(scheduleValidityKey, true)
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

          {/* Nightly sweep cadence — shared by both webhook branches (generic-REST +
              app connector), the self-heal for missed webhook deliveries (v9 Phase 6). */}
          {behavior === 'webhook' && <SweepCadenceSection connector={connector} />}

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
