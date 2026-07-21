// apps/web/src/components/dispatch/ui/dispatch-general-settings-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Clock, Lock, Route as RouteIcon } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'General' }]

/**
 * Dispatch General settings page (plan 20 §5) — currently just the route auto-sync switch;
 * follows `invoicing-page.tsx`'s exact recipe (admin-gated, feature-gated, `useDirtyDraft` +
 * `FormSaveBar` over a scalar `DRAFT_KEYS` slice of the `'GENERAL'` scope).
 */
export function DispatchGeneralSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='General'
        description='General dispatch and route planner behavior.'
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return <DispatchGeneralSettingsBody />
}

/** Scalar catalog keys this page's draft owns — `useSettings({scope:'GENERAL'})` returns every
 * `'GENERAL'`-scope setting across the whole app, so the draft/save must stay scoped to exactly
 * these keys or a save here would clobber unrelated GENERAL settings. */
const DRAFT_KEYS = [
  'dispatch.routes.autoApplyTimes',
  'dispatch.board.timelineStartHour',
  'dispatch.board.timelineEndHour',
] as const

function DispatchGeneralSettingsBody() {
  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'GENERAL',
  })

  // Rebuilt each render; `useDirtyDraft` compares by value so a fresh identity never reseeds.
  const server: Record<string, SettingValue> = {}
  for (const key of DRAFT_KEYS) server[key] = getSetting(key)

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
      const changed = DRAFT_KEYS.filter((key) => next[key] !== server[key]).map((key) => ({
        key,
        value: next[key] ?? null,
      }))
      if (changed.length > 0) batchUpdateOrganizationSettings(changed)
    },
  })

  const controlled = (key: (typeof DRAFT_KEYS)[number]) => ({
    value: draft[key],
    // NUMBER inputs report a clear as `undefined` (the node-input convention), not `null` —
    // normalize here since `SettingValue`/the server normalizer only accept `null` for "unset".
    onChange: (value: unknown) =>
      patch({ [key]: (value === undefined ? null : value) as SettingValue }),
  })

  return (
    <SettingsPage
      title='General'
      description='General dispatch and route planner behavior.'
      breadcrumbs={BREADCRUMBS}>
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection
          icon={RouteIcon}
          title='Routes'
          description='How the route planner keeps stop times in sync with route order.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='dispatch-general-settings'
            defaultLabelWidth={260}>
            <SettingsFieldRow
              settingKey='dispatch.routes.autoApplyTimes'
              title='Auto-apply times on reorder'
              description='Reordering a route automatically re-chains provisional stop times. Confirmed (promised) times stay fixed — reordering around them surfaces a conflict instead of moving them.'
              {...controlled('dispatch.routes.autoApplyTimes')}
            />
          </FieldPanel>
        </SettingsSection>

        <SettingsSection
          icon={Clock}
          title='Board'
          description='Dispatch board timeline view behavior.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='dispatch-general-settings-board'
            defaultLabelWidth={260}>
            <SettingsFieldRow
              settingKey='dispatch.board.timelineStartHour'
              title='Timeline start hour'
              description='Automatic — working hours ± 2h buffer. Set both start and end to override.'
              placeholder='Automatic'
              {...controlled('dispatch.board.timelineStartHour')}
            />
            <SettingsFieldRow
              settingKey='dispatch.board.timelineEndHour'
              title='Timeline end hour'
              description='Automatic — working hours ± 2h buffer. Set both start and end to override.'
              placeholder='Automatic'
              {...controlled('dispatch.board.timelineEndHour')}
            />
          </FieldPanel>
        </SettingsSection>

        <FormSaveBar
          dirty={dirty}
          isSaving={isBatchUpdatingOrgSettings}
          onSave={save}
          onDiscard={discard}
        />
      </div>
    </SettingsPage>
  )
}
