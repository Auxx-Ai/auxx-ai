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

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

type SyncBehavior = 'manual' | 'scheduled' | 'webhook'

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

  // Behavior + schedule fields are one buffered draft behind a single Save —
  // flip mode to 'auto' for autosave (plan §6). Both edits dirty the same draft.
  const draft = useBufferedConfig(
    {
      behavior: (connector.syncBehavior as SyncBehavior) ?? 'manual',
      schedule: scheduledStateFromConfig(
        connector.scheduleConfig as Record<string, unknown> | null
      ),
    },
    (value) => {
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
        })
      }
      return update.mutateAsync({
        id: connector.id,
        syncBehavior: value.behavior,
        scheduleConfig: null,
      })
    },
    { mode: 'manual' }
  )
  const { behavior, schedule } = draft.value

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

        <Button
          className='self-start'
          size='sm'
          disabled={!draft.isDirty}
          loading={update.isPending}
          onClick={() => void draft.commit()}>
          Save schedule
        </Button>
      </div>
    </Section>
  )
}
