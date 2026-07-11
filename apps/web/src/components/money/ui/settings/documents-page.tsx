// apps/web/src/components/money/ui/settings/documents-page.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { FeatureKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { getFileRefDownloadUrl, toFileRef } from '@auxx/types/file-ref'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Building2, Eye, FileText, Lock, Palette, Receipt } from 'lucide-react'
import {
  type AddressStruct,
  AddressStructFields,
} from '~/components/fields/inputs/address-struct-input-field'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { type DocumentsLogo, DocumentsLogoCell } from './documents-logo-cell'

interface BusinessTaxId {
  label: string
  value: string
}

/** `documents.business` JSON blob shape — address is the canonical `AddressStruct`. */
interface BusinessInfo {
  companyName: string
  address: AddressStruct
  phone: string
  email: string
  website: string
  taxId: BusinessTaxId
}

const EMPTY_TAX_ID: BusinessTaxId = { label: '', value: '' }

/** Map a stored address blob (new `AddressStruct` or the legacy `{line1,line2,region,zip}`) to `AddressStruct`. */
function normalizeAddress(raw: unknown): AddressStruct {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, string>
  return {
    street1: s.street1 ?? s.line1 ?? '',
    street2: s.street2 ?? s.line2 ?? '',
    city: s.city ?? '',
    state: s.state ?? s.region ?? '',
    zipCode: s.zipCode ?? s.zip ?? '',
    country: s.country ?? '',
  }
}

/** Merge a stored (possibly partial/old-shape) value with defaults so the form never crashes on a fresh org. */
function normalizeBusiness(raw: unknown): BusinessInfo {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<BusinessInfo>
  return {
    companyName: source.companyName ?? '',
    address: normalizeAddress(source.address),
    phone: source.phone ?? '',
    email: source.email ?? '',
    website: source.website ?? '',
    taxId: { ...EMPTY_TAX_ID, ...(source.taxId ?? {}) },
  }
}

/** Scalar catalog keys the page draft owns (`documents.business` is handled separately as a blob). */
const SCALAR_DRAFT_KEYS = [
  'organization.currency',
  'documents.accentColor',
  'documents.paperSize',
  'documents.dateFormat',
  'documents.quote.defaultTerms',
  'documents.quote.validDays',
  'documents.quote.footerText',
  'documents.quote.lineDisplay',
  'documents.quote.showDescriptions',
  'documents.invoice.dueDays',
  'documents.invoice.paymentInstructions',
  'documents.invoice.footerText',
  'documents.invoice.lineDisplay',
  'documents.invoice.showDescriptions',
  'documents.invoice.showPaymentHistory',
] as const

const BUSINESS_KEY = 'documents.business'

type DocumentsDraft = Record<string, SettingValue>

/**
 * Documents settings page (money MQ2 §F.2) — business identity, branding, quote
 * defaults, invoice defaults. Plain form page, no tabs (02-document-settings.md
 * decision). The whole page is a single page-level draft with one bottom
 * {@link FormSaveBar}: every `SettingsFieldRow` runs controlled and feeds the draft,
 * saved in one `batchUpdateOrganizationSettings` call (10-settings-forms-unification.md).
 * Logo upload is the one deliberate exception — a file upload is inherently a commit.
 */
export function DocumentsSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Documents' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Documents'
        description='Configure the business info, branding, and defaults used on quote and invoice PDFs.'
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

  return <DocumentsSettingsBody breadcrumbs={breadcrumbs} />
}

function DocumentsSettingsBody({ breadcrumbs }: { breadcrumbs: { title: string }[] }) {
  // Unscoped instance: reads every documents.* key AND the GENERAL-scope `organization.currency`,
  // and `batchUpdateOrganizationSettings` is per-key scope-aware so one call carries them all.
  const {
    getSetting,
    batchUpdateOrganizationSettings,
    updateOrganizationSetting,
    isBatchUpdatingOrgSettings,
  } = useSettings({})

  const storedLogo = getSetting('documents.logo') as DocumentsLogo | null

  // Server snapshot for every key the draft owns (logo excluded — immediate upload). Rebuilt each
  // render; `useDirtyDraft` compares by value, so a fresh object identity never triggers a reseed.
  const server: DocumentsDraft = { [BUSINESS_KEY]: normalizeBusiness(getSetting(BUSINESS_KEY)) }
  for (const key of SCALAR_DRAFT_KEYS) server[key] = getSetting(key)

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
      const changed: Array<{ key: string; value: SettingValue }> = []
      if (JSON.stringify(next[BUSINESS_KEY]) !== JSON.stringify(server[BUSINESS_KEY])) {
        changed.push({ key: BUSINESS_KEY, value: next[BUSINESS_KEY] })
      }
      for (const key of SCALAR_DRAFT_KEYS) {
        if (next[key] !== server[key]) changed.push({ key, value: next[key] })
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
    onChange: (value: unknown) => patch({ [key]: value as SettingValue }),
  })

  const previewPdf = api.money.previewDocumentPdf.useMutation({
    onSuccess: (data) => {
      window.open(getFileRefDownloadUrl(toFileRef('asset', data.assetId)), '_blank')
    },
    onError: (error) =>
      toastError({ title: 'Failed to render preview', description: error.message }),
  })

  return (
    <SettingsPage
      title='Documents'
      description='Configure the business info, branding, and defaults used on quote and invoice PDFs.'
      breadcrumbs={breadcrumbs}
      button={
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => previewPdf.mutate()}
          loading={previewPdf.isPending}
          loadingText='Rendering...'>
          <Eye />
          Preview PDF
        </Button>
      }>
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        <div className='grid grid-cols-1 items-start gap-8 lg:grid-cols-2'>
          <BusinessInfoSection
            business={business}
            onPatchBusiness={patchBusiness}
            currency={controlled('organization.currency')}
          />

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
                resizeId='documents-settings'
                defaultLabelWidth={200}>
                <SettingsFieldRow
                  settingKey='documents.accentColor'
                  title='Accent color'
                  {...controlled('documents.accentColor')}
                />
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

          <SettingsSection
            icon={FileText}
            title='Quotes'
            description='Defaults applied to new quotes and their PDFs.'>
            <FieldPanel className='mt-1 p-0' resizeId='documents-settings' defaultLabelWidth={200}>
              <SettingsFieldRow
                settingKey='documents.quote.defaultTerms'
                title='Default terms'
                {...controlled('documents.quote.defaultTerms')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.validDays'
                title='Valid for (days)'
                {...controlled('documents.quote.validDays')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.footerText'
                title='Footer text'
                {...controlled('documents.quote.footerText')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.lineDisplay'
                title='Line item display'
                {...controlled('documents.quote.lineDisplay')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.showDescriptions'
                title='Show descriptions'
                {...controlled('documents.quote.showDescriptions')}
              />
            </FieldPanel>
          </SettingsSection>

          <SettingsSection
            icon={Receipt}
            title='Invoices'
            description='Defaults for invoice PDFs — these apply once invoicing ships (MI1); the settings save now so they are ready.'>
            <FieldPanel className='mt-1 p-0' resizeId='documents-settings' defaultLabelWidth={200}>
              <SettingsFieldRow
                settingKey='documents.invoice.dueDays'
                title='Due (days)'
                {...controlled('documents.invoice.dueDays')}
              />
              <SettingsFieldRow
                settingKey='documents.invoice.paymentInstructions'
                title='Payment instructions'
                {...controlled('documents.invoice.paymentInstructions')}
              />
              <SettingsFieldRow
                settingKey='documents.invoice.footerText'
                title='Footer text'
                {...controlled('documents.invoice.footerText')}
              />
              <SettingsFieldRow
                settingKey='documents.invoice.lineDisplay'
                title='Line item display'
                {...controlled('documents.invoice.lineDisplay')}
              />
              <SettingsFieldRow
                settingKey='documents.invoice.showDescriptions'
                title='Show descriptions'
                {...controlled('documents.invoice.showDescriptions')}
              />
              <SettingsFieldRow
                settingKey='documents.invoice.showPaymentHistory'
                title='Show payment history'
                {...controlled('documents.invoice.showPaymentHistory')}
              />
            </FieldPanel>
          </SettingsSection>
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

interface BusinessInfoSectionProps {
  business: BusinessInfo
  onPatchBusiness: (next: Partial<BusinessInfo>) => void
  /** Controlled props for the `organization.currency` row (GENERAL scope, edited here). */
  currency: { value: unknown; onChange: (value: unknown) => void }
}

/**
 * Presentational `documents.business` blob form — no local state; the whole page's
 * {@link useDirtyDraft} owns the draft and save. The `organization.currency` row rides along as a
 * controlled `SettingsFieldRow` (currency stays `GENERAL` scope — 02-document-settings.md decision).
 */
function BusinessInfoSection({ business, onPatchBusiness, currency }: BusinessInfoSectionProps) {
  return (
    <SettingsSection
      icon={Building2}
      title='Business info'
      description='Printed on every quote and invoice PDF.'>
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='documents-business-info'
        defaultLabelWidth={200}
        className='p-0'>
        <SettingsFieldRow
          settingKey='organization.currency'
          title='Currency'
          value={currency.value}
          onChange={currency.onChange}
        />

        <FieldPanelRow title='Company name' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={business.companyName}
            onChange={(value) => onPatchBusiness({ companyName: value as string })}
            placeholder='Acme Co.'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Address' type={BaseType.ADDRESS} showIcon>
          <div className='py-2'>
            <AddressStructFields
              value={business.address}
              onChange={(address) => onPatchBusiness({ address })}
              className='flex flex-col gap-2'
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow title='Phone' type={BaseType.PHONE} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.PHONE_INTL}
            value={business.phone}
            onChange={(value) => onPatchBusiness({ phone: value as string })}
            placeholder='(555) 555-0100'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Email' type={BaseType.EMAIL} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.EMAIL}
            value={business.email}
            onChange={(value) => onPatchBusiness({ email: value as string })}
            placeholder='billing@acme.com'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Website' type={BaseType.URL} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.URL}
            value={business.website}
            onChange={(value) => onPatchBusiness({ website: value as string })}
            placeholder='https://acme.com'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Tax ID label' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={business.taxId.label}
            onChange={(value) =>
              onPatchBusiness({ taxId: { ...business.taxId, label: value as string } })
            }
            placeholder='EIN'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Tax ID value' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={business.taxId.value}
            onChange={(value) =>
              onPatchBusiness({ taxId: { ...business.taxId, value: value as string } })
            }
            placeholder='12-3456789'
          />
        </FieldPanelRow>
      </FieldPanel>
    </SettingsSection>
  )
}
