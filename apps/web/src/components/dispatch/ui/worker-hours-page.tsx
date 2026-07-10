// apps/web/src/components/dispatch/ui/worker-hours-page.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import type { WeeklyHours } from '@auxx/lib/availability/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useState } from 'react'
import {
  validateWeeklyDraft,
  type WeeklyHoursDraft,
  WeeklyHoursEditor,
} from '~/components/availability/ui/weekly-hours-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

/** Same draft-builder as `AvailabilitySettingsPage` — a day present w/ ranges → enabled. */
function buildDraftFromResponse(
  weekly: WeeklyHours | null,
  timezoneFallback: string
): WeeklyHoursDraft {
  const byDay = new Map(weekly?.days.map((d) => [d.dayOfWeek, d]))
  return {
    timezone: weekly?.timezone || timezoneFallback,
    days: ALL_DAYS.map((dayOfWeek) => {
      const day = byDay.get(dayOfWeek)
      return {
        dayOfWeek,
        enabled: !!day && day.ranges.length > 0,
        ranges: day?.ranges.map((r) => ({ start: r.start, end: r.end })) ?? [],
      }
    }),
  }
}

interface WorkerHoursPageProps {
  userId: string
  weekStartsOn: 0 | 1 | 6
  use24HourTime: boolean
}

/**
 * Worker Hours page (05-availability.md §E.2 decision 8): a top "Use organization default"
 * switch. ON = no worker weekly rows exist — the org's schedule renders read-only. Flipping OFF
 * seeds an editable copy of the org's current schedule (client-side; persisted on Save).
 * Flipping back ON discards the override via `useConfirm`; Save then replaces the worker's rows
 * with an empty set (deletes them), returning to inherited.
 */
export function WorkerHoursPage({ userId, weekStartsOn, use24HourTime }: WorkerHoursPageProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const subject = { type: 'worker' as const, userId }
  const workerQuery = api.availability.getWeeklyHours.useQuery({ subject })
  const orgQuery = api.availability.getWeeklyHours.useQuery({ subject: { type: 'organization' } })

  const [useOrgDefault, setUseOrgDefault] = useState(true)
  const [draft, setDraft] = useState<WeeklyHoursDraft | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!workerQuery.isSuccess) return
    if (dirty) return
    const hasWorkerRows = workerQuery.data !== null
    setUseOrgDefault(!hasWorkerRows)
    setDraft(hasWorkerRows ? buildDraftFromResponse(workerQuery.data, detectTimezone()) : null)
  }, [workerQuery.isSuccess, workerQuery.data, dirty])

  const saveWeeklyHours = api.availability.saveWeeklyHours.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.availability.getWeeklyHours.invalidate({ subject })
    },
    onError: (error) => toastError({ title: 'Error saving hours', description: error.message }),
  })

  const orgDraft = buildDraftFromResponse(orgQuery.data ?? null, detectTimezone())
  const loading = !workerQuery.isSuccess || !orgQuery.isSuccess

  async function handleToggleUseOrgDefault(next: boolean) {
    if (next) {
      const confirmed = await confirm({
        title: 'Discard custom hours?',
        description:
          "Switching back to the organization's default hours discards this worker's custom hours when you save.",
        confirmText: 'Discard',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      setUseOrgDefault(true)
      setDirty(true)
      return
    }
    setDraft((prev) => prev ?? orgDraft)
    setUseOrgDefault(false)
    setDirty(true)
  }

  function handleDiscard() {
    const hasWorkerRows = workerQuery.data !== null
    setUseOrgDefault(!hasWorkerRows)
    setDraft(
      hasWorkerRows ? buildDraftFromResponse(workerQuery.data ?? null, detectTimezone()) : null
    )
    setDirty(false)
  }

  function handleSave() {
    if (useOrgDefault) {
      // Replace-all with zero rows == delete the worker's override.
      saveWeeklyHours.mutate({
        subject,
        weekly: { timezone: draft?.timezone ?? orgDraft.timezone, days: [] },
      })
      return
    }
    if (!draft) return
    const weekly: WeeklyHours = {
      timezone: draft.timezone,
      days: draft.days
        .filter((d) => d.enabled)
        .map((d) => ({
          dayOfWeek: d.dayOfWeek,
          ranges: d.ranges.filter(
            (r): r is { start: number; end: number } => r.start != null && r.end != null
          ),
        }))
        .filter((d) => d.ranges.length > 0),
    }
    saveWeeklyHours.mutate({ subject, weekly })
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      <div className='flex items-center justify-between rounded-lg border px-3 py-2.5'>
        <div>
          <p className='text-sm font-medium'>Use organization default</p>
          <p className='text-xs text-muted-foreground'>
            Follow the org's weekly hours, or set custom hours for this worker.
          </p>
        </div>
        <Switch
          checked={useOrgDefault}
          onCheckedChange={handleToggleUseOrgDefault}
          disabled={loading}
        />
      </div>

      {loading ? (
        <Skeleton className='h-48 w-full rounded-xl' />
      ) : (
        <WeeklyHoursEditor
          value={useOrgDefault ? orgDraft : (draft ?? orgDraft)}
          onChange={(next) => {
            setDraft(next)
            setDirty(true)
          }}
          weekStartsOn={weekStartsOn}
          use24HourTime={use24HourTime}
          readOnly={useOrgDefault}
        />
      )}

      {dirty && (
        <div className='flex items-center justify-end gap-3 border-t pt-3'>
          <span className='mr-auto text-xs text-muted-foreground'>Unsaved changes</span>
          <Button type='button' variant='outline' size='sm' onClick={handleDiscard}>
            Discard
          </Button>
          <Button
            type='button'
            size='sm'
            disabled={!useOrgDefault && draft != null && !validateWeeklyDraft(draft)}
            loading={saveWeeklyHours.isPending}
            onClick={handleSave}>
            Save
          </Button>
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}
