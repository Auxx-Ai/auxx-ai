// apps/web/src/components/availability/ui/availability-settings-page.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import type { WeeklyHours } from '@auxx/lib/availability/client'
import { weekStartToIndex } from '@auxx/lib/availability/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CalendarOff, Clock, Globe, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ExceptionListEditor } from '~/components/availability/ui/exception-list-editor'
import {
  validateWeeklyDraft,
  type WeeklyHoursDraft,
  WeeklyHoursEditor,
} from '~/components/availability/ui/weekly-hours-editor'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

/**
 * Build the editor draft from the router's `getWeeklyHours` response: a day present with
 * ranges → enabled + its ranges; absent (or `null` response, a brand-new org) → disabled,
 * empty ranges (05-availability.md §E.1).
 */
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

/** A catalog SINGLE_SELECT value read via `getSetting` is a scalar, but normalize defensively. */
function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

/**
 * Org Availability settings page (dispatch settings, 05-availability.md §E.1): weekly hours
 * (explicit save, page-owned dirty state) + holidays/exceptions (self-fetching, immediate
 * mutations). Gated like the rest of dispatch settings — admin/owner role + `FeatureKey.dispatch`.
 */
export function AvailabilitySettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()
  const { getSetting } = useSettings({ scope: 'GENERAL' })

  const utils = api.useUtils()
  const weeklyQuery = api.availability.getWeeklyHours.useQuery({
    subject: { type: 'organization' },
  })

  const [draft, setDraft] = useState<WeeklyHoursDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [snapshot, setSnapshot] = useState<WeeklyHoursDraft | null>(null)

  useEffect(() => {
    if (!weeklyQuery.isSuccess) return
    // Never clobber in-progress edits — a background refetch (window refocus, another admin
    // saving) must not wipe the local draft. The post-save refetch rebuilds because
    // `onSuccess` clears `dirty` before invalidating.
    if (dirty) return
    const built = buildDraftFromResponse(weeklyQuery.data, detectTimezone())
    setDraft(built)
    setSnapshot(built)
  }, [weeklyQuery.isSuccess, weeklyQuery.data, dirty])

  const saveWeeklyHours = api.availability.saveWeeklyHours.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.availability.getWeeklyHours.invalidate({ subject: { type: 'organization' } })
    },
    onError: (error) =>
      toastError({ title: 'Error saving weekly hours', description: error.message }),
  })

  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)
  const use24HourTime = Boolean(scalarSetting(getSetting('organization.use24HourTime')))

  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Availability' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Availability'
        description='Set business hours and holiday exceptions used across dispatch scheduling.'
        breadcrumbs={breadcrumbs}>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  function handleDiscard() {
    setDraft(snapshot)
    setDirty(false)
  }

  function handleSave() {
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
    saveWeeklyHours.mutate({ subject: { type: 'organization' }, weekly })
  }

  return (
    <SettingsPage
      title='Availability'
      description='Set business hours and holiday exceptions used across dispatch scheduling.'
      breadcrumbs={breadcrumbs}>
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection
          icon={Clock}
          title='Weekly hours'
          description='The default schedule dispatch uses to determine when your organization is open.'>
          <FieldPanel className='mt-1 p-0' resizeId='availability-settings' defaultLabelWidth={220}>
            <SettingsFieldRow settingKey='organization.weekStart' title='Week starts on' />
            <SettingsFieldRow settingKey='organization.use24HourTime' title='Use 24-hour time' />
            {draft && (
              <FieldPanelRow
                title='Time zone'
                description='All weekly hours below are interpreted in this time zone.'
                showIcon
                icon={<Globe />}>
                <TimeZonePicker
                  selected={draft.timezone}
                  onChange={(timezone) => {
                    setDraft({ ...draft, timezone })
                    setDirty(true)
                  }}
                  triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
                />
              </FieldPanelRow>
            )}
          </FieldPanel>
          {draft ? (
            <div className='flex flex-col gap-3'>
              <WeeklyHoursEditor
                value={draft}
                onChange={(next) => {
                  setDraft(next)
                  setDirty(true)
                }}
                weekStartsOn={weekStartsOn}
                use24HourTime={use24HourTime}
              />
              {dirty && (
                <div className='flex items-center justify-end gap-3 border-t pt-3'>
                  <span className='mr-auto text-xs text-muted-foreground'>Unsaved changes</span>
                  <Button type='button' variant='outline' size='sm' onClick={handleDiscard}>
                    Discard
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    disabled={!validateWeeklyDraft(draft)}
                    loading={saveWeeklyHours.isPending}
                    onClick={handleSave}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Skeleton className='h-48 w-full rounded-xl' />
          )}
        </SettingsSection>

        <SettingsSection
          icon={CalendarOff}
          title='Holidays & exceptions'
          description='Org exceptions apply to every worker and widget.'>
          <ExceptionListEditor subject={{ type: 'organization' }} use24HourTime={use24HourTime} />
        </SettingsSection>
      </div>
    </SettingsPage>
  )
}
