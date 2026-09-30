// apps/web/src/components/manufacturing/ui/settings/parts-settings-page.tsx
'use client'

// Inventory > General (25-parts-settings-tab.md §4; build mode: plans/mrp/17 §6).
// Draft keys are listed explicitly: `useSettings({ scope: 'GENERAL' })` returns every GENERAL
// setting in the app, so an unscoped save would clobber unrelated ones.

import { PermissionKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Factory, SlidersHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { SettingsSection } from '~/components/global/settings-page'
import { BackfillBuildsButton } from '~/components/manufacturing/builds/backfill-builds-button'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useAccess, useRequireCapability } from '~/providers/capabilities-provider'
import { StandardCostSection } from './standard-cost-section'

const PAGE_DESCRIPTION = 'How builds are recorded, planning defaults and standard costs'

/**
 * Not in the draft: `autoBuildEnabledAt`, which the write path stamps on off→on (a draft would
 * write it back stale, AB8), and `autoBuildStatus`, which has one legal value (AB5).
 */
const PARTS_SETTINGS_KEYS = {
  autoBuildFromOrders: 'inventory.autoBuildFromOrders',
  autoBuildStockRule: 'inventory.autoBuildStockRule',
  backflush: 'inventory.backflush',
} as const

/** The two keys behind the one build-mode choice; the write refuses both on (111 Q14). */
type BuildMode = 'sales' | 'orders' | 'off'

function buildModeOf(backflush: SettingValue, fromOrders: SettingValue): BuildMode {
  if (backflush === true) return 'sales'
  if (fromOrders === true) return 'orders'
  return 'off'
}

const DRAFT_KEYS = [
  PARTS_SETTINGS_KEYS.autoBuildFromOrders,
  PARTS_SETTINGS_KEYS.autoBuildStockRule,
  PARTS_SETTINGS_KEYS.backflush,
  'mrp.aduWindowDays',
  'mrp.defaultLeadTimeFactor',
  'mrp.defaultVariabilityFactor',
  'mrp.runRetentionDays',
] as const

export function PartsGeneralSettingsPage() {
  // Matches the server exactly: `setting.updateOrganizationSetting` and
  // `setting.batchUpdateOrganizationSettings` both assert `settingsManage`, so
  // the client gate cannot be more permissive than the mutation. There is no
  // `inventory.*` or `parts.*` permission key, and no `FeatureKey` either — the
  // parts list itself is ungated, so a feature gate here would make Settings
  // vanish from a module that is otherwise fully available.
  useRequireCapability(PermissionKey.settingsManage)
  const showMrp = useAccess().can(PermissionKey.mrpManage)

  useRegisterModuleToolbar(
    useMemo(() => ({ left: <ToolbarTitle hint={PAGE_DESCRIPTION}>General</ToolbarTitle> }), [])
  )

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
    // SELECT inputs report a clear as `undefined`; the server only accepts `null` for unset.
    onChange: (value: unknown) =>
      patch({ [key]: (value === undefined ? null : value) as SettingValue }),
  })

  const buildMode = buildModeOf(
    draft[PARTS_SETTINGS_KEYS.backflush] ?? null,
    draft[PARTS_SETTINGS_KEYS.autoBuildFromOrders] ?? null
  )
  const setBuildMode = (mode: string) =>
    patch({
      [PARTS_SETTINGS_KEYS.backflush]: mode === 'sales',
      [PARTS_SETTINGS_KEYS.autoBuildFromOrders]: mode === 'orders',
    })

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {/* Two independent flex columns, like Accounting > Settings > General: builds and planning on the
            left, the tall standard-cost section alone on the right. */}
        <div className='grid grid-cols-1 items-start gap-8 p-3 sm:p-6 lg:grid-cols-2'>
          <div className='flex flex-col gap-8'>
            <SettingsSection
              title='How builds are recorded'
              icon={Factory}
              description='For parts you make rather than buy.'
              action={showMrp ? <BackfillBuildsButton /> : undefined}>
              <RadioGroup value={buildMode} onValueChange={setBuildMode}>
                <RadioGroupItemCard
                  value='sales'
                  label='From sales, every night'
                  description="Best when you build to stock and don't track builds by hand."
                />
                <RadioGroupItemCard
                  value='orders'
                  label='From orders, as planned builds'
                  description='Best when each order is built. Someone completes each one.'
                />
                <RadioGroupItemCard
                  value='off'
                  label='Off'
                  description='Builds are only recorded by hand.'
                />
              </RadioGroup>
              {buildMode === 'orders' && (
                <>
                  <FieldPanel
                    className='mt-1 p-0'
                    resizeId='parts-general-auto-build'
                    defaultLabelWidth={220}>
                    <SettingsFieldRow
                      settingKey={PARTS_SETTINGS_KEYS.autoBuildStockRule}
                      title='When to raise one'
                      {...controlled(PARTS_SETTINGS_KEYS.autoBuildStockRule)}
                    />
                  </FieldPanel>
                  <p className='text-muted-foreground text-xs'>
                    Only orders placed after you choose this.
                  </p>
                </>
              )}
            </SettingsSection>

            {showMrp && (
              <SettingsSection
                title='MRP'
                icon={SlidersHorizontal}
                description='What the plan uses for a part that does not set its own.'>
                <FieldPanel
                  className='mt-1 p-0'
                  resizeId='parts-general-auto-build'
                  defaultLabelWidth={220}>
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
              </SettingsSection>
            )}
          </div>
          <div className='flex flex-col gap-8'>
            <StandardCostSection />
          </div>
        </div>
      </ScrollArea>

      {/* One batch, one transaction: the build mode flips two keys together. The padding is
          what `FormSaveBar`'s negative margins cancel. */}
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
