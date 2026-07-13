// apps/web/src/components/dispatch/ui/worker-hours-page.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import type { WeeklyHours } from '@auxx/lib/availability/client'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import {
  validateWeeklyDraft,
  type WeeklyHoursDraft,
  WeeklyHoursEditor,
} from '~/components/availability/ui/weekly-hours-editor'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import {
  availabilitySubjectKey,
  useAvailabilityCacheStore,
} from '../stores/availability-cache-store'

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

/** Collapse an editor draft to the persisted `WeeklyHours` shape (drop disabled days / empty ranges). */
function toWeeklyHours(draft: WeeklyHoursDraft): WeeklyHours {
  return {
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
}

/** Page draft: the "inherit org default" switch plus (when overriding) the worker's weekly copy. */
interface WorkerHoursState {
  useOrgDefault: boolean
  weekly: WeeklyHoursDraft | null
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
 * with an empty set (deletes them), returning to inherited. Draft/save run on the shared
 * {@link useDirtyDraft} + a dialog footer (10-settings-forms-unification.md).
 */
export function WorkerHoursPage({ userId, weekStartsOn, use24HourTime }: WorkerHoursPageProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const subject = { type: 'worker' as const, userId }
  const workerQuery = api.availability.getWeeklyHours.useQuery({ subject })
  const orgQuery = api.availability.getWeeklyHours.useQuery({ subject: { type: 'organization' } })

  const orgDraft = buildDraftFromResponse(orgQuery.data ?? null, detectTimezone())
  const loading = !workerQuery.isSuccess || !orgQuery.isSuccess

  const saveWeeklyHours = api.availability.saveWeeklyHours.useMutation({
    onSuccess: () => {
      utils.availability.getWeeklyHours.invalidate({ subject })
      // Drop the board's cached shading for this worker so it re-fetches the new hours.
      useAvailabilityCacheStore.getState().invalidate(availabilitySubjectKey(subject))
    },
    onError: (error) => toastError({ title: 'Error saving hours', description: error.message }),
  })

  // A worker with no rows inherits the org default; present rows → an editable override.
  const hasWorkerRows = workerQuery.data != null
  const server: WorkerHoursState = {
    useOrgDefault: !hasWorkerRows,
    weekly: hasWorkerRows ? buildDraftFromResponse(workerQuery.data, detectTimezone()) : null,
  }

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: saveWeeklyHours.isPending,
    onSave: (next) => {
      if (next.useOrgDefault) {
        // Replace-all with zero rows == delete the worker's override.
        saveWeeklyHours.mutate({
          subject,
          weekly: { timezone: next.weekly?.timezone ?? orgDraft.timezone, days: [] },
        })
        return
      }
      if (!next.weekly) return
      saveWeeklyHours.mutate({ subject, weekly: toWeeklyHours(next.weekly) })
    },
  })

  async function handleToggleUseOrgDefault(nextOn: boolean) {
    if (nextOn) {
      const confirmed = await confirm({
        title: 'Discard custom hours?',
        description:
          "Switching back to the organization's default hours discards this worker's custom hours when you save.",
        confirmText: 'Discard',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      patch({ useOrgDefault: true })
      return
    }
    patch({ useOrgDefault: false, weekly: draft.weekly ?? orgDraft })
  }

  const editorValue = draft.useOrgDefault ? orgDraft : (draft.weekly ?? orgDraft)
  const saveDisabled =
    !draft.useOrgDefault && draft.weekly != null && !validateWeeklyDraft(draft.weekly)

  return (
    <div className='flex flex-col gap-4 p-4'>
      <ToggleCard
        title='Use organization default'
        description="Follow the org's weekly hours, or set custom hours for this worker."
        checked={draft.useOrgDefault}
        onCheckedChange={handleToggleUseOrgDefault}
        switchSize='default'
        disabled={loading}
      />

      {loading ? (
        <Skeleton className='h-48 w-full rounded-xl' />
      ) : (
        <WeeklyHoursEditor
          value={editorValue}
          onChange={(weekly) => patch({ weekly })}
          weekStartsOn={weekStartsOn}
          use24HourTime={use24HourTime}
          readOnly={draft.useOrgDefault}
        />
      )}

      <DialogFooter className='border-t pt-3'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={discard}
          disabled={!dirty || saveWeeklyHours.isPending}>
          Discard
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={save}
          loading={saveWeeklyHours.isPending}
          loadingText='Saving...'
          disabled={!dirty || saveDisabled}
          data-dialog-submit>
          Save <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>

      <ConfirmDialog />
    </div>
  )
}
