// apps/web/src/components/mrp/ui/settings/mrp-settings-page.tsx
'use client'

// Parts > Manage > MRP settings (plans/mrp/07-ui-plan.md §4.8): the planner's
// org defaults, saved as one batch the way Parts > Manage > General saves.

import { PermissionKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { SlidersHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useAccess, useRequireCapability } from '~/providers/capabilities-provider'

const PAGE_DESCRIPTION = 'Usage window, default factors and run retention'

// `useSettings({ scope: 'GENERAL' })` returns every GENERAL setting in the app, so the save is scoped to these keys.
const DRAFT_KEYS = [
  'mrp.aduWindowDays',
  'mrp.defaultLeadTimeFactor',
  'mrp.defaultVariabilityFactor',
  'mrp.runRetentionDays',
] as const

type MrpSettingKey = (typeof DRAFT_KEYS)[number]

export function MrpSettingsPage() {
  useRequireCapability(PermissionKey.mrpManage)
  // The router takes `mrp.manage` for an all-`mrp.*` batch, so the rows need no admin role.
  const canEdit = useAccess().can(PermissionKey.mrpManage)

  useRegisterModuleToolbar(
    useMemo(() => ({ left: <ToolbarTitle hint={PAGE_DESCRIPTION}>MRP settings</ToolbarTitle> }), [])
  )

  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'GENERAL',
  })

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

  /** Controlled-mode props for a catalog `SettingsFieldRow` fed by this draft. */
  const controlled = (key: MrpSettingKey) => ({
    canEdit,
    value: draft[key],
    onChange: (value: unknown) =>
      patch({ [key]: (value === undefined ? null : value) as SettingValue }),
  })

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <Section
          title='Defaults'
          icon={<SlidersHorizontal className='size-4' />}
          description='What the plan uses for a part that does not set its own.'
          collapsible={false}>
          <FieldPanel className='p-0' resizeId='mrp-settings-defaults' defaultLabelWidth={220}>
            <SettingsFieldRow
              settingKey='mrp.aduWindowDays'
              title='Usage window (days)'
              {...controlled('mrp.aduWindowDays')}
            />
            <SettingsFieldRow
              settingKey='mrp.defaultLeadTimeFactor'
              title='Lead-time factor'
              placeholder='class default'
              {...controlled('mrp.defaultLeadTimeFactor')}
            />
            <SettingsFieldRow
              settingKey='mrp.defaultVariabilityFactor'
              title='Variability factor'
              placeholder='from usage'
              {...controlled('mrp.defaultVariabilityFactor')}
            />
            <SettingsFieldRow
              settingKey='mrp.runRetentionDays'
              title='Keep runs for (days)'
              {...controlled('mrp.runRetentionDays')}
            />
          </FieldPanel>
        </Section>

        {/* TODO(111 X5): backflush switch and "Backflush past sales" action land with accounting task 111 */}
      </ScrollArea>

      {/* The wrapper's padding is what `FormSaveBar`'s negative margins cancel. */}
      <div className='shrink-0 px-3 pb-3 sm:px-6 sm:pb-6'>
        <FormSaveBar
          dirty={dirty}
          isSaving={isBatchUpdatingOrgSettings}
          onSave={save}
          onDiscard={discard}
        />
      </div>
    </div>
  )
}
