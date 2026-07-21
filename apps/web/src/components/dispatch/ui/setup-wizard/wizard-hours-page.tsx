// apps/web/src/components/dispatch/ui/setup-wizard/wizard-hours-page.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import type { WeeklyHours } from '@auxx/lib/availability/client'
import { weekStartToIndex } from '@auxx/lib/availability/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { forwardRef, useImperativeHandle } from 'react'
import {
  validateWeeklyDraft,
  type WeeklyHoursDraft,
  WeeklyHoursEditor,
} from '~/components/availability/ui/weekly-hours-editor'
import { useAvailabilityCacheStore } from '~/components/dispatch/stores/availability-cache-store'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { useSettings } from '~/hooks/use-settings'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import type { WizardStepHandle } from './wizard-step-handle'

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

/** Build the editor draft from the router's `getWeeklyHours` response (mirrors the availability settings page). */
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

function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

/**
 * Page 4 of `DispatchSetupWizard` — the org-subject `WeeklyHoursEditor` (05-availability.md
 * §E.1), same draft/save mechanics as the Availability settings page. Unlike the auto-saving
 * Workers/Address pages, hours need an explicit, validated save — so this page exposes a
 * `tryAdvance` handle the wizard shell calls before navigating away in *either* direction
 * (Back, Continue, or "Set up later"): it saves a dirty-and-valid draft, or blocks navigation
 * with a toast when the draft is dirty but invalid, so entered hours are never silently lost.
 */
export const WizardHoursPage = forwardRef<WizardStepHandle>(function WizardHoursPage(_props, ref) {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const utils = api.useUtils()

  const weeklyQuery = api.availability.getWeeklyHours.useQuery(
    { subject: { type: 'organization' } },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  const saveWeeklyHours = api.availability.saveWeeklyHours.useMutation({
    onSuccess: () => {
      utils.availability.getWeeklyHours.invalidate({ subject: { type: 'organization' } })
      useAvailabilityCacheStore.getState().invalidateAll()
    },
    onError: (error) =>
      toastError({ title: 'Error saving weekly hours', description: error.message }),
  })

  const server = buildDraftFromResponse(weeklyQuery.data ?? null, detectTimezone())
  const { draft, setDraft, dirty, save } = useDirtyDraft(server, {
    isSaving: saveWeeklyHours.isPending,
    onSave: (next) =>
      saveWeeklyHours.mutate({ subject: { type: 'organization' }, weekly: toWeeklyHours(next) }),
  })

  useImperativeHandle(ref, () => ({
    tryAdvance: () => {
      if (!dirty) return true
      if (!validateWeeklyDraft(draft)) {
        toastError({
          title: 'Fix your hours before continuing',
          description: 'Some days have incomplete or overlapping time ranges.',
        })
        return false
      }
      save()
      return true
    },
  }))

  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)
  const use24HourTime = Boolean(scalarSetting(getSetting('organization.use24HourTime')))

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        The default schedule dispatch uses to determine when your organization is open.
      </p>
      {weeklyQuery.isSuccess ? (
        <WeeklyHoursEditor
          value={draft}
          onChange={setDraft}
          weekStartsOn={weekStartsOn}
          use24HourTime={use24HourTime}
        />
      ) : (
        <Skeleton className='h-48 w-full rounded-xl' />
      )}
    </div>
  )
})
