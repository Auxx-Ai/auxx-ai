// apps/web/src/components/dispatch/ui/dispatch-general-settings-page.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Building2, CalendarDays, Lock, Palette } from 'lucide-react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import {
  BusinessAddressFields,
  type BusinessInfo,
  normalizeBusiness,
} from '~/components/money/ui/settings/business-address-fields'
import {
  type DocumentsLogo,
  DocumentsLogoCell,
} from '~/components/money/ui/settings/documents-logo-cell'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { ColorField } from '~/components/ui/color-field'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'General' }]

const BUSINESS_KEY = 'documents.business'

/** Scalar catalog keys this page's draft owns — a mix of `GENERAL` (currency, regional) and
 * `DOCUMENTS` (branding) scope keys, so the page reads `useSettings({})` unscoped and
 * `batchUpdateOrganizationSettings` is per-key scope-aware to carry them all in one call. */
const SCALAR_DRAFT_KEYS = [
  'organization.currency',
  'organization.weekStart',
  'organization.use24HourTime',
  'documents.accentColor',
  'documents.paperSize',
  'documents.dateFormat',
] as const

type GeneralDraft = Record<string, SettingValue>

/**
 * Dispatch General settings page (34-settings-reorg.md) — org identity: business info (moved
 * from the old Documents page, `documents.business` + `organization.currency`), regional
 * defaults (`organization.weekStart`/`use24HourTime`, moved off Scheduling), and branding
 * (logo/accent/paper size/date format, also from Documents). One page-level draft + one
 * bottom {@link FormSaveBar} (10-settings-forms-unification.md) — logo upload stays immediate
 * (a file upload is inherently a commit).
 */
export function DispatchGeneralSettingsPage() {
  useRequireCapability(PermissionKey.settingsManage)
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='General'
        description='Business identity, regional defaults, and document branding.'
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

function DispatchGeneralSettingsBody() {
  // Unscoped instance: reads GENERAL (currency, regional) and DOCUMENTS (branding) keys, and
  // `batchUpdateOrganizationSettings` is per-key scope-aware so one call carries them all.
  const {
    getSetting,
    batchUpdateOrganizationSettings,
    updateOrganizationSetting,
    isBatchUpdatingOrgSettings,
  } = useSettings({})

  const storedLogo = getSetting('documents.logo') as DocumentsLogo | null

  // Server snapshot for every key the draft owns (logo excluded — immediate upload). Rebuilt each
  // render; `useDirtyDraft` compares by value, so a fresh object identity never triggers a reseed.
  const server: GeneralDraft = { [BUSINESS_KEY]: normalizeBusiness(getSetting(BUSINESS_KEY)) }
  for (const key of SCALAR_DRAFT_KEYS) server[key] = getSetting(key)

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
      const changed: Array<{ key: string; value: SettingValue }> = []
      if (JSON.stringify(next[BUSINESS_KEY]) !== JSON.stringify(server[BUSINESS_KEY])) {
        changed.push({ key: BUSINESS_KEY, value: next[BUSINESS_KEY] })
      }
      for (const key of SCALAR_DRAFT_KEYS) {
        if (next[key] !== server[key]) changed.push({ key, value: next[key] ?? null })
      }
      if (changed.length > 0) batchUpdateOrganizationSettings(changed)
    },
  })

  const business = draft[BUSINESS_KEY] as BusinessInfo
  const patchBusiness = (next: Partial<BusinessInfo>) =>
    patch({ [BUSINESS_KEY]: { ...business, ...next } })

  /** Controlled-mode props for a catalog `SettingsFieldRow` fed by the page draft. */
  const controlled = (key: (typeof SCALAR_DRAFT_KEYS)[number]) => ({
    value: draft[key],
    // NUMBER/SELECT inputs report a clear as `undefined`, not `null` — normalize since
    // `SettingValue`/the server normalizer only accept `null` for "unset".
    onChange: (value: unknown) =>
      patch({ [key]: (value === undefined ? null : value) as SettingValue }),
  })

  return (
    <SettingsPage
      title='General'
      description='Business identity, regional defaults, and document branding.'
      breadcrumbs={BREADCRUMBS}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <div className='grid grid-cols-1 items-start gap-8 lg:grid-cols-2'>
          <SettingsSection
            icon={Building2}
            title='Business info'
            description='Printed on every quote and invoice PDF.'>
            <FieldPanel
              orientation='responsive'
              breakpoint='md'
              resizeId='general-business-info'
              defaultLabelWidth={200}
              className='p-0'>
              <SettingsFieldRow
                settingKey='organization.currency'
                title='Currency'
                {...controlled('organization.currency')}
              />

              <FieldPanelRow title='Company name' type={BaseType.STRING} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={business.companyName}
                  onChange={(value) => patchBusiness({ companyName: value as string })}
                  placeholder='Acme Co.'
                />
              </FieldPanelRow>

              <BusinessAddressFields
                value={business.address}
                onChange={(address) => patchBusiness({ address })}
              />

              <FieldPanelRow title='Phone' type={BaseType.PHONE} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.PHONE_INTL}
                  value={business.phone}
                  onChange={(value) => patchBusiness({ phone: value as string })}
                  placeholder='(555) 555-0100'
                />
              </FieldPanelRow>

              <FieldPanelRow title='Email' type={BaseType.EMAIL} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.EMAIL}
                  value={business.email}
                  onChange={(value) => patchBusiness({ email: value as string })}
                  placeholder='billing@acme.com'
                />
              </FieldPanelRow>

              <FieldPanelRow title='Website' type={BaseType.URL} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.URL}
                  value={business.website}
                  onChange={(value) => patchBusiness({ website: value as string })}
                  placeholder='https://acme.com'
                />
              </FieldPanelRow>

              <FieldPanelRow title='Tax ID label' type={BaseType.STRING} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={business.taxId.label}
                  onChange={(value) =>
                    patchBusiness({ taxId: { ...business.taxId, label: value as string } })
                  }
                  placeholder='EIN'
                />
              </FieldPanelRow>

              <FieldPanelRow title='Tax ID value' type={BaseType.STRING} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={business.taxId.value}
                  onChange={(value) =>
                    patchBusiness({ taxId: { ...business.taxId, value: value as string } })
                  }
                  placeholder='12-3456789'
                />
              </FieldPanelRow>
            </FieldPanel>
          </SettingsSection>

          <div className='flex flex-col gap-8'>
            <SettingsSection
              icon={CalendarDays}
              title='Regional'
              description='Defaults used across the dispatch board and scheduling.'>
              <FieldPanel className='mt-1 p-0' resizeId='general-regional' defaultLabelWidth={200}>
                <SettingsFieldRow
                  settingKey='organization.weekStart'
                  title='Week starts on'
                  {...controlled('organization.weekStart')}
                />
                <SettingsFieldRow
                  settingKey='organization.use24HourTime'
                  title='Use 24-hour time'
                  {...controlled('organization.use24HourTime')}
                />
              </FieldPanel>
            </SettingsSection>

            <SettingsSection
              icon={Palette}
              title='Branding'
              description='Logo and visual styling applied to quote/invoice PDFs.'>
              <div className='flex flex-col gap-4'>
                <DocumentsLogoCell
                  value={storedLogo}
                  onChange={(next) => updateOrganizationSetting('documents.logo', next)}
                />
                <FieldPanel
                  className='mt-1 p-0'
                  resizeId='general-branding'
                  defaultLabelWidth={200}>
                  <SettingsFieldRow settingKey='documents.accentColor' title='Accent color'>
                    <ColorField
                      value={(draft['documents.accentColor'] as string) || ''}
                      onChange={(value) =>
                        patch({ 'documents.accentColor': value === '' ? null : value })
                      }
                      clearable
                    />
                  </SettingsFieldRow>
                  <SettingsFieldRow
                    settingKey='documents.paperSize'
                    title='Paper size'
                    {...controlled('documents.paperSize')}
                  />
                  <SettingsFieldRow
                    settingKey='documents.dateFormat'
                    title='Date format'
                    {...controlled('documents.dateFormat')}
                  />
                </FieldPanel>
              </div>
            </SettingsSection>
          </div>
        </div>

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
