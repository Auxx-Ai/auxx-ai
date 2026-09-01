// apps/web/src/components/manufacturing/ui/settings/parts-settings-page.tsx
'use client'

// Parts > Settings > General (25-parts-settings-tab.md §4).
//
// Shape A, the sectioned form page: `SettingsPage` + `SettingsSection` +
// `FieldPanel` + `SettingsFieldRow`, over one `useDirtyDraft` slice and one
// `FormSaveBar`. One section, one column — there is not enough here for the
// two-column flow `accounting/ui/settings/general-settings-page.tsx` uses.
//
// 🛑 Draft keys are scoped explicitly. `useSettings({ scope: 'GENERAL' })`
// returns EVERY `GENERAL`-scope setting in the whole app and both keys here are
// `GENERAL` (there is no `INVENTORY` value in the `SettingScope` pg enum), so an
// unscoped save would clobber unrelated settings.

import { PermissionKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Factory } from 'lucide-react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useRequireCapability } from '~/providers/capabilities-provider'

const BREADCRUMBS = [
  { title: 'Parts', href: '/app/parts' },
  { title: 'Settings' },
  { title: 'General' },
]

const PAGE_DESCRIPTION = 'Whether an order raises a build, and for which parts.'

/**
 * The two catalog keys this page owns.
 *
 * 🛑 The other two `inventory.autoBuild*` keys are deliberately absent, and
 * neither omission is an oversight:
 *
 * - `inventory.autoBuildEnabledAt` is written by the settings write path itself.
 *   Both `updateOrganizationSetting` and `batchUpdateOrganizationSettings` read
 *   the previous value BEFORE the upsert and call `stampAutoBuildEnabledAt` on
 *   an off->on transition (AB8). Putting it in a draft would write a stale value
 *   back in the same batch that flips the switch, defeating the stamp — and the
 *   stamp is the only thing between turning auto-build on and manufacturing
 *   against years of back-filled order history.
 * - `inventory.autoBuildStatus` has ONE legal value: `resolveAutoBuildStatus`
 *   ignores its argument and returns `'planned'` unconditionally (AB5). A select
 *   with one option is a control that cannot be operated, and it would advertise
 *   a `completed` mode that aborts `completeBuild` on its first run.
 */
const PARTS_SETTINGS_KEYS = {
  autoBuildFromOrders: 'inventory.autoBuildFromOrders',
  autoBuildStockRule: 'inventory.autoBuildStockRule',
} as const

const DRAFT_KEYS = [
  PARTS_SETTINGS_KEYS.autoBuildFromOrders,
  PARTS_SETTINGS_KEYS.autoBuildStockRule,
] as const

export function PartsGeneralSettingsPage() {
  // Matches the server exactly: `setting.updateOrganizationSetting` and
  // `setting.batchUpdateOrganizationSettings` both assert `settingsManage`, so
  // the client gate cannot be more permissive than the mutation. There is no
  // `inventory.*` or `parts.*` permission key, and no `FeatureKey` either — the
  // parts list itself is ungated, so a feature gate here would make Settings
  // vanish from a module that is otherwise fully available.
  useRequireCapability(PermissionKey.settingsManage)

  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'GENERAL',
  })

  // Rebuilt each render; `useDirtyDraft` compares by value, so a fresh object
  // identity never triggers a reseed.
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
  const controlled = (key: (typeof DRAFT_KEYS)[number]) => ({
    value: draft[key],
    // SELECT inputs report a clear as `undefined`, not `null` — normalize, since
    // `SettingValue` and the server normalizer only accept `null` for "unset".
    onChange: (value: unknown) =>
      patch({ [key]: (value === undefined ? null : value) as SettingValue }),
  })

  return (
    <SettingsPage title='General' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection
          icon={Factory}
          title='Automatic builds'
          description='When an order asks for a part that is made rather than bought, raise the production run for it.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='parts-general-auto-build'
            defaultLabelWidth={220}>
            <SettingsFieldRow
              settingKey={PARTS_SETTINGS_KEYS.autoBuildFromOrders}
              title='Raise builds from orders'
              {...controlled(PARTS_SETTINGS_KEYS.autoBuildFromOrders)}
            />
            <SettingsFieldRow
              settingKey={PARTS_SETTINGS_KEYS.autoBuildStockRule}
              title='When to raise one'
              {...controlled(PARTS_SETTINGS_KEYS.autoBuildStockRule)}
            />
          </FieldPanel>

          {/*
            Three things that are true, non-obvious, and will otherwise be
            discovered as bugs. They live here rather than in the catalog's own
            `description` strings, which are also the connector and API surface.
          */}
          <div className='space-y-2 text-muted-foreground text-xs'>
            <p>
              Only orders placed <strong>after</strong> this is switched on are built. Turning it
              off and on again restarts the window, so a switch left off for three months does not
              reopen those three months when it comes back.
            </p>
            <p>
              A build is raised only for a part that is made rather than purchased{' '}
              <strong>and</strong> has a bill of materials. An order line for a purchased component,
              or for a part whose bill of materials is empty, raises nothing.
            </p>
            <p>
              What gets raised is a <strong>planned</strong> build. It moves no stock and records no
              cost until somebody completes it, which is what makes this safe to turn on before a
              part has a standard cost.
            </p>
          </div>
        </SettingsSection>

        {/*
          One draft, one bar. Both keys save in a single
          `batchUpdateOrganizationSettings` call, which the settings service runs
          in one transaction — that is the reason this page does not use
          `SettingsFieldRow`'s default autosave. The stock rule only means
          anything while the switch is on, so an autosaved switch would leave the
          reconciler live under whichever rule was stored while the person is
          still reaching for the second row.
        */}
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
