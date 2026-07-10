// apps/web/src/components/money/ui/settings/documents-page.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { getFileRefDownloadUrl, toFileRef } from '@auxx/types/file-ref'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Building2, Eye, FileText, Lock, Palette, Receipt } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { type DocumentsLogo, DocumentsLogoCell } from './documents-logo-cell'

interface BusinessAddress {
  line1: string
  line2: string
  city: string
  zip: string
  region: string
  country: string
}

interface BusinessTaxId {
  label: string
  value: string
}

/** `documents.business` JSON blob shape (settings catalog.ts comment, 02-document-settings.md). */
interface BusinessInfo {
  companyName: string
  address: BusinessAddress
  phone: string
  email: string
  website: string
  taxId: BusinessTaxId
}

const EMPTY_ADDRESS: BusinessAddress = {
  line1: '',
  line2: '',
  city: '',
  zip: '',
  region: '',
  country: '',
}
const EMPTY_TAX_ID: BusinessTaxId = { label: '', value: '' }

/** Merge a stored (possibly partial/old-shape) value with defaults so the form never crashes on a fresh org. */
function normalizeBusiness(raw: unknown): BusinessInfo {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<BusinessInfo>
  return {
    companyName: source.companyName ?? '',
    address: { ...EMPTY_ADDRESS, ...(source.address ?? {}) },
    phone: source.phone ?? '',
    email: source.email ?? '',
    website: source.website ?? '',
    taxId: { ...EMPTY_TAX_ID, ...(source.taxId ?? {}) },
  }
}

/**
 * Documents settings page (money MQ2 §F.2) — business identity, branding, quote
 * defaults, invoice defaults. Plain form page, no tabs (02-document-settings.md
 * decision). Business info + logo are bespoke JSON-blob sections (explicit
 * save / upload cell); the rest are catalog-driven `SettingsFieldRow` autosave
 * rows on the `DOCUMENTS` scope (money MQ2 §A.2).
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
  const { getSetting, updateOrganizationSetting, isUpdatingOrgSetting } = useSettings({
    scope: 'DOCUMENTS',
  })

  const storedBusiness = getSetting('documents.business')
  const storedLogo = getSetting('documents.logo') as DocumentsLogo | null

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
        <BusinessInfoSection
          storedBusiness={storedBusiness}
          onSaveBusiness={(next) => updateOrganizationSetting('documents.business', next)}
          isSaving={isUpdatingOrgSetting}
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
            <FieldPanel className='mt-1 p-0' resizeId='documents-settings' defaultLabelWidth={200}>
              <SettingsFieldRow settingKey='documents.accentColor' title='Accent color' />
              <SettingsFieldRow settingKey='documents.paperSize' title='Paper size' />
              <SettingsFieldRow settingKey='documents.dateFormat' title='Date format' />
            </FieldPanel>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={FileText}
          title='Quotes'
          description='Defaults applied to new quotes and their PDFs.'>
          <FieldPanel className='mt-1 p-0' resizeId='documents-settings' defaultLabelWidth={200}>
            <SettingsFieldRow settingKey='documents.quote.defaultTerms' title='Default terms' />
            <SettingsFieldRow settingKey='documents.quote.validDays' title='Valid for (days)' />
            <SettingsFieldRow settingKey='documents.quote.footerText' title='Footer text' />
            <SettingsFieldRow settingKey='documents.quote.lineDisplay' title='Line item display' />
            <SettingsFieldRow
              settingKey='documents.quote.showDescriptions'
              title='Show descriptions'
            />
          </FieldPanel>
        </SettingsSection>

        <SettingsSection
          icon={Receipt}
          title='Invoices'
          description='Defaults for invoice PDFs — these apply once invoicing ships (MI1); the settings save now so they are ready.'>
          <FieldPanel className='mt-1 p-0' resizeId='documents-settings' defaultLabelWidth={200}>
            <SettingsFieldRow settingKey='documents.invoice.dueDays' title='Due (days)' />
            <SettingsFieldRow
              settingKey='documents.invoice.paymentInstructions'
              title='Payment instructions'
            />
            <SettingsFieldRow settingKey='documents.invoice.footerText' title='Footer text' />
            <SettingsFieldRow
              settingKey='documents.invoice.lineDisplay'
              title='Line item display'
            />
            <SettingsFieldRow
              settingKey='documents.invoice.showDescriptions'
              title='Show descriptions'
            />
            <SettingsFieldRow
              settingKey='documents.invoice.showPaymentHistory'
              title='Show payment history'
            />
          </FieldPanel>
        </SettingsSection>
      </div>
    </SettingsPage>
  )
}

interface BusinessInfoSectionProps {
  storedBusiness: unknown
  onSaveBusiness: (next: BusinessInfo) => void
  isSaving: boolean
}

/**
 * Bespoke `documents.business` JSON-blob form — local draft + one explicit
 * Save button (the availability weekly-hours draft/dirty pattern), since the
 * value is a single structured object rather than a scalar catalog key. Also
 * hosts the `organization.currency` row: `SettingsFieldRow` owns its own
 * `useSettings({})` instance internally (no scope filter), so it reads/writes
 * correctly here even though this page's own `useSettings` call is scoped to
 * `DOCUMENTS` (currency stays `GENERAL` — 02-document-settings.md decision).
 */
function BusinessInfoSection({
  storedBusiness,
  onSaveBusiness,
  isSaving,
}: BusinessInfoSectionProps) {
  const [draft, setDraft] = useState<BusinessInfo>(() => normalizeBusiness(storedBusiness))
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    // Never clobber in-progress edits on a background refetch/optimistic re-render — the
    // post-save rebuild happens because `dirty` flips false right after `handleSave`.
    if (dirty) return
    setDraft(normalizeBusiness(storedBusiness))
  }, [storedBusiness, dirty])

  function patch(next: Partial<BusinessInfo>) {
    setDraft((prev) => ({ ...prev, ...next }))
    setDirty(true)
  }

  function patchAddress(next: Partial<BusinessAddress>) {
    patch({ address: { ...draft.address, ...next } })
  }

  function patchTaxId(next: Partial<BusinessTaxId>) {
    patch({ taxId: { ...draft.taxId, ...next } })
  }

  function handleDiscard() {
    setDraft(normalizeBusiness(storedBusiness))
    setDirty(false)
  }

  function handleSave() {
    onSaveBusiness(draft)
    setDirty(false)
  }

  return (
    <SettingsSection
      icon={Building2}
      title='Business info'
      description='Printed on every quote and invoice PDF.'>
      <div className='flex flex-col gap-3'>
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='documents-business-info'
          defaultLabelWidth={200}
          className='p-0'>
          <SettingsFieldRow settingKey='organization.currency' title='Currency' />

          <FieldPanelRow title='Company name' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.companyName}
              onChange={(value) => patch({ companyName: value as string })}
              placeholder='Acme Co.'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Address line 1' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.address.line1}
              onChange={(value) => patchAddress({ line1: value as string })}
              placeholder='123 Main St'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Address line 2' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.address.line2}
              onChange={(value) => patchAddress({ line2: value as string })}
              placeholder='Suite 100'
            />
          </FieldPanelRow>

          <FieldPanelRow title='City' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.address.city}
              onChange={(value) => patchAddress({ city: value as string })}
              placeholder='Springfield'
            />
          </FieldPanelRow>

          <FieldPanelRow title='ZIP / postal code' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.address.zip}
              onChange={(value) => patchAddress({ zip: value as string })}
              placeholder='90210'
            />
          </FieldPanelRow>

          <FieldPanelRow title='State / region' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.address.region}
              onChange={(value) => patchAddress({ region: value as string })}
              placeholder='CA'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Country' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.address.country}
              onChange={(value) => patchAddress({ country: value as string })}
              placeholder='United States'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Phone' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.phone}
              onChange={(value) => patch({ phone: value as string })}
              placeholder='(555) 555-0100'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Email' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.email}
              onChange={(value) => patch({ email: value as string })}
              placeholder='billing@acme.com'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Website' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.website}
              onChange={(value) => patch({ website: value as string })}
              placeholder='https://acme.com'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Tax ID label' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.taxId.label}
              onChange={(value) => patchTaxId({ label: value as string })}
              placeholder='EIN'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Tax ID value' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.taxId.value}
              onChange={(value) => patchTaxId({ value: value as string })}
              placeholder='12-3456789'
            />
          </FieldPanelRow>
        </FieldPanel>

        {dirty && (
          <div className='flex items-center justify-end gap-3 border-t pt-3'>
            <span className='mr-auto text-xs text-muted-foreground'>Unsaved changes</span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleDiscard}
              disabled={isSaving}>
              Discard
            </Button>
            <Button type='button' size='sm' onClick={handleSave} loading={isSaving}>
              Save
            </Button>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
