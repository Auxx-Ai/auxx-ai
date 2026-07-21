// apps/web/src/components/dispatch/hooks/use-worker-hours-draft.ts
'use client'

import { detectTimezone } from '@auxx/config/client'
import type { WeeklyHours } from '@auxx/lib/availability/client'
import { toastError } from '@auxx/ui/components/toast'
import {
  validateWeeklyDraft,
  type WeeklyHoursDraft,
} from '~/components/availability/ui/weekly-hours-editor'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { useConfirm } from '~/hooks/use-confirm'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import {
  availabilitySubjectKey,
  useAvailabilityCacheStore,
} from '../stores/availability-cache-store'

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

/** Same draft-builder as `SchedulingSettingsPage` — a day present w/ ranges → enabled. */
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

export type WorkerHoursDraftApi = ReturnType<typeof useWorkerHoursDraft>

/**
 * Draft + persistence for the worker Hours page (05-availability.md §E.2 decision 8), hoisted
 * to the dialog level: `DialogNavPages` unmounts inactive pages, so page-owned drafts would
 * silently drop edits on a tab switch and unmounted `useMutation` callbacks would skip their
 * invalidation. "Use organization default" ON = no worker weekly rows exist — the org's
 * schedule renders read-only. Flipping OFF seeds an editable copy of the org's current
 * schedule (client-side; persisted on Save). Flipping back ON resets the draft to the server
 * value — asking first only when there's something to lose — and Save then replaces the
 * worker's rows with an empty set (deletes them), returning to inherited.
 *
 * `userId` is null during the dialog's create mode (member-select page) — the worker query
 * stays disabled and the draft idles on the inherited default until the worker exists.
 */
export function useWorkerHoursDraft(userId: string | null) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const subject = { type: 'worker' as const, userId: userId ?? '' }
  const workerQuery = api.availability.getWeeklyHours.useQuery(
    { subject },
    { staleTime: ORG_STATIC_STALE_TIME, enabled: userId != null }
  )
  const orgQuery = api.availability.getWeeklyHours.useQuery(
    { subject: { type: 'organization' } },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

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

  const { draft, patch, dirty, save } = useDirtyDraft(server, {
    isSaving: saveWeeklyHours.isPending,
    onSave: (next) => {
      if (userId == null) return
      if (next.useOrgDefault) {
        // Replace-all with zero rows == delete the worker's override.
        saveWeeklyHours.mutate({
          subject,
          weekly: {
            timezone: next.weekly?.timezone ?? orgDraft.timezone,
            days: [],
          },
        })
        return
      }
      if (!next.weekly) return
      saveWeeklyHours.mutate({ subject, weekly: toWeeklyHours(next.weekly) })
    },
  })

  async function toggleUseOrgDefault(nextOn: boolean) {
    if (!nextOn) {
      patch({ useOrgDefault: false, weekly: draft.weekly ?? orgDraft })
      return
    }
    // Confirm only when something is actually lost: saved custom rows (deleted on save), or
    // edits made to the seeded copy. A pristine seed flips back silently.
    const baseline = hasWorkerRows ? server.weekly : orgDraft
    const edited = draft.weekly != null && JSON.stringify(draft.weekly) !== JSON.stringify(baseline)
    if (hasWorkerRows || edited) {
      const confirmed = await confirm({
        title: 'Discard custom hours?',
        description:
          "Switching back to the organization's default hours discards this worker's custom hours when you save.",
        confirmText: 'Discard',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }
    // Reset `weekly` to the server value — leaving the seeded copy in the draft would keep the
    // by-value dirty compare stuck after an OFF → ON round trip.
    patch({ useOrgDefault: true, weekly: server.weekly })
  }

  const setWeekly = (weekly: WeeklyHoursDraft) => patch({ weekly })

  const editorValue = draft.useOrgDefault ? orgDraft : (draft.weekly ?? orgDraft)
  const saveDisabled =
    !draft.useOrgDefault && draft.weekly != null && !validateWeeklyDraft(draft.weekly)

  return {
    loading,
    useOrgDefault: draft.useOrgDefault,
    editorValue,
    toggleUseOrgDefault,
    setWeekly,
    dirty,
    isSaving: saveWeeklyHours.isPending,
    saveDisabled,
    save,
    ConfirmDialog,
  }
}
