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
import { toastError } from '@auxx/ui/components/toast'
import { ChevronDown, Clock } from 'lucide-react'
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
 * `syncBehavior` (Manual · Scheduled), NOT a list of triggers (05 §5).
 * Scheduled reveals the shared `ScheduleEditor` round-tripping `scheduleConfig`;
 * the floor is coarse (hours/days). Webhook is a later placeholder (omitted from
 * the picker until delivery is implemented).
 */
export function ScheduleSection({ connector }: ScheduleSectionProps) {
  const utils = api.useUtils()

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not save schedule', description: e.message }),
  })

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
              {behavior === 'scheduled' ? 'Scheduled' : 'Manual'}
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
              onChange={(next: ScheduledState) => draft.set({ ...draft.value, schedule: next })}
            />
            <p className='text-xs text-muted-foreground'>
              Minimum cadence is 5 minutes — connectors don’t sync more often than that.
            </p>
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
