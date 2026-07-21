// apps/web/src/components/availability/ui/scheduling-settings-page.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import type { WeeklyHours } from '@auxx/lib/availability/client'
import { weekStartToIndex } from '@auxx/lib/availability/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CalendarOff, Clock, Globe, Lock, Route as RouteIcon } from 'lucide-react'
import { ExceptionListEditor } from '~/components/availability/ui/exception-list-editor'
import {
  validateWeeklyDraft,
  type WeeklyHoursDraft,
  WeeklyHoursEditor,
} from '~/components/availability/ui/weekly-hours-editor'
import { useAvailabilityCacheStore } from '~/components/dispatch/stores/availability-cache-store'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
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

/** A catalog SINGLE_SELECT value read via `getSetting` is a scalar, but normalize defensively. */
function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

/** Scalar catalog keys the Routes + Board draft owns (moved here from the old General page,
 * 34-settings-reorg.md) — `useSettings({scope:'GENERAL'})` returns every `'GENERAL'`-scope
 * setting across the whole app, so the draft/save must stay scoped to exactly these keys or a
 * save here would clobber unrelated GENERAL settings (including `organization.weekStart`/
 * `use24HourTime`, now owned by the General page's own draft). */
const ROUTES_BOARD_DRAFT_KEYS = [
  'dispatch.routes.autoApplyTimes',
  'dispatch.board.timelineStartHour',
  'dispatch.board.timelineEndHour',
] as const

/**
 * Org Scheduling settings page (dispatch settings, 34-settings-reorg.md — retitled from
 * "Availability"): weekly hours + holidays/exceptions (unchanged from the old Availability
 * page) plus Routes + Board (moved from the old General page). Each section keeps its own
 * {@link useDirtyDraft}/save slice — weekly hours saves via `saveWeeklyHours`, Routes/Board via
 * `batchUpdateOrganizationSettings` — so they don't share a draft. Gated like the rest of
 * dispatch settings — admin/owner role + `FeatureKey.dispatch`.
 */
export function SchedulingSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()
  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'GENERAL',
  })

  const utils = api.useUtils()
  const weeklyQuery = api.availability.getWeeklyHours.useQuery(
    {
      subject: { type: 'organization' },
    },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  const saveWeeklyHours = api.availability.saveWeeklyHours.useMutation({
    onSuccess: () => {
      utils.availability.getWeeklyHours.invalidate({
        subject: { type: 'organization' },
      })
      // Org hours drive every column (workers inherit the org default) — drop the whole board cache.
      useAvailabilityCacheStore.getState().invalidateAll()
    },
    onError: (error) =>
      toastError({
        title: 'Error saving weekly hours',
        description: error.message,
      }),
  })

  // Rebuilt each render; `useDirtyDraft` reseeds by value, so a background refetch never wipes edits.
  const server = buildDraftFromResponse(weeklyQuery.data ?? null, detectTimezone())
  const { draft, patch, setDraft, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: saveWeeklyHours.isPending,
    onSave: (next) =>
      saveWeeklyHours.mutate({
        subject: { type: 'organization' },
        weekly: toWeeklyHours(next),
      }),
  })

  // Rebuilt each render; `useDirtyDraft` compares by value so a fresh identity never reseeds.
  const routesBoardServer: Record<string, SettingValue> = {}
  for (const key of ROUTES_BOARD_DRAFT_KEYS) routesBoardServer[key] = getSetting(key)

  const {
    draft: routesBoardDraft,
    patch: patchRoutesBoard,
    dirty: routesBoardDirty,
    save: saveRoutesBoard,
    discard: discardRoutesBoard,
  } = useDirtyDraft(routesBoardServer, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
      const changed = ROUTES_BOARD_DRAFT_KEYS.filter(
        (key) => next[key] !== routesBoardServer[key]
      ).map((key) => ({
        key,
        value: next[key] ?? null,
      }))
      if (changed.length > 0) batchUpdateOrganizationSettings(changed)
    },
  })

  const controlledRoutesBoard = (key: (typeof ROUTES_BOARD_DRAFT_KEYS)[number]) => ({
    value: routesBoardDraft[key],
    // NUMBER inputs report a clear as `undefined` (the node-input convention), not `null` —
    // normalize here since `SettingValue`/the server normalizer only accept `null` for "unset".
    onChange: (value: unknown) =>
      patchRoutesBoard({ [key]: (value === undefined ? null : value) as SettingValue }),
  })

  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)
  const use24HourTime = Boolean(scalarSetting(getSetting('organization.use24HourTime')))

  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Scheduling' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Scheduling'
        description='Set business hours, holiday exceptions, and route/board behavior used across dispatch.'
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

  return (
    <SettingsPage
      title='Scheduling'
      description='Set business hours, holiday exceptions, and route/board behavior used across dispatch.'
      breadcrumbs={breadcrumbs}>
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        <div className='grid grid-cols-1 items-start gap-8 lg:grid-cols-2'>
          <SettingsSection
            icon={Clock}
            title='Weekly hours'
            description='The default schedule dispatch uses to determine when your organization is open.'>
            <FieldPanel className='mt-1 p-0' resizeId='scheduling-settings' defaultLabelWidth={220}>
              {weeklyQuery.isSuccess && (
                <FieldPanelRow
                  title='Time zone'
                  description='All weekly hours below are interpreted in this time zone.'
                  showIcon
                  icon={<Globe />}>
                  <TimeZonePicker
                    selected={draft.timezone}
                    onChange={(timezone) => patch({ timezone })}
                    triggerProps={{
                      variant: 'transparent',
                      className: 'w-full ps-0 pe-1',
                    }}
                  />
                </FieldPanelRow>
              )}
            </FieldPanel>
            {weeklyQuery.isSuccess ? (
              <div className='flex flex-col gap-3'>
                <WeeklyHoursEditor
                  value={draft}
                  onChange={setDraft}
                  weekStartsOn={weekStartsOn}
                  use24HourTime={use24HourTime}
                />
                <FormSaveBar
                  dirty={dirty}
                  isSaving={saveWeeklyHours.isPending}
                  onSave={save}
                  onDiscard={discard}
                  saveDisabled={!validateWeeklyDraft(draft)}
                />
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

        <div className='grid grid-cols-1 items-start gap-8 lg:grid-cols-2'>
          <SettingsSection
            icon={RouteIcon}
            title='Routes'
            description='How the route planner keeps stop times in sync with route order.'>
            <FieldPanel className='mt-1 p-0' resizeId='scheduling-routes' defaultLabelWidth={260}>
              <SettingsFieldRow
                settingKey='dispatch.routes.autoApplyTimes'
                title='Auto-apply times on reorder'
                description='Reordering a route automatically re-chains provisional stop times. Confirmed (promised) times stay fixed — reordering around them surfaces a conflict instead of moving them.'
                {...controlledRoutesBoard('dispatch.routes.autoApplyTimes')}
              />
            </FieldPanel>
          </SettingsSection>

          <SettingsSection
            icon={Clock}
            title='Board'
            description='Dispatch board timeline view behavior.'>
            <FieldPanel className='mt-1 p-0' resizeId='scheduling-board' defaultLabelWidth={260}>
              <SettingsFieldRow
                settingKey='dispatch.board.timelineStartHour'
                title='Timeline start hour'
                description='Automatic — working hours ± 2h buffer. Set both start and end to override.'
                placeholder='Automatic'
                {...controlledRoutesBoard('dispatch.board.timelineStartHour')}
              />
              <SettingsFieldRow
                settingKey='dispatch.board.timelineEndHour'
                title='Timeline end hour'
                description='Automatic — working hours ± 2h buffer. Set both start and end to override.'
                placeholder='Automatic'
                {...controlledRoutesBoard('dispatch.board.timelineEndHour')}
              />
            </FieldPanel>
          </SettingsSection>
        </div>

        <FormSaveBar
          dirty={routesBoardDirty}
          isSaving={isBatchUpdatingOrgSettings}
          onSave={saveRoutesBoard}
          onDiscard={discardRoutesBoard}
        />
      </div>
    </SettingsPage>
  )
}
