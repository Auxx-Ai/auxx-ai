// apps/web/src/components/money/ui/settings/invoicing-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { FileText, Lock, Receipt } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Invoicing settings page (money MI2 build spec §O.3, retitled "Invoicing" per
 * 34-settings-reorg.md) — the master switch, default timing, and date basis for automated
 * invoice drafts, plus invoice PDF defaults (moved from the old Documents page). Quote
 * acceptance and partial payments moved out to the Quotes and Payments pages respectively.
 * Admin-gated, plain form page: one `useSettings({scope: 'DOCUMENTS'})` instance via
 * `SettingsFieldRow`, no tabs.
 *
 * `defaultTiming` also write-throughs onto the two `quote_invoice_timing`/
 * `work_order_invoice_timing` `CustomField.defaultValue` rows on save — see
 * `packages/lib/src/settings/settings-service.ts` (`updateOrganizationSetting`).
 */
export function InvoicingSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Invoicing' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Invoicing'
        description='Configure automated invoice drafts and PDF defaults for completed jobs and visits.'
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

  return <InvoicingSettingsBody breadcrumbs={breadcrumbs} />
}

/** Scalar catalog keys the Invoicing draft owns. */
const DRAFT_KEYS = [
  'documents.invoice.autoEnabled',
  'documents.invoice.defaultTiming',
  'documents.invoice.dateBasis',
  'documents.invoice.dueDays',
  'documents.invoice.paymentInstructions',
  'documents.invoice.footerText',
  'documents.invoice.lineDisplay',
  'documents.invoice.showDescriptions',
  'documents.invoice.showPaymentHistory',
] as const

function InvoicingSettingsBody({ breadcrumbs }: { breadcrumbs: { title: string }[] }) {
  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'DOCUMENTS',
  })

  // Rebuilt each render; `useDirtyDraft` compares by value so a fresh identity never reseeds.
  const server: Record<string, SettingValue> = {}
  for (const key of DRAFT_KEYS) server[key] = getSetting(key)

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
      // `defaultTiming` write-throughs onto the two `*_invoice_timing` CustomField.defaultValue rows
      // via the batch path — send only changed keys so an untouched save doesn't re-fire it.
      const changed = DRAFT_KEYS.filter((key) => next[key] !== server[key]).map((key) => ({
        key,
        value: next[key],
      }))
      if (changed.length > 0) batchUpdateOrganizationSettings(changed)
    },
  })

  const controlled = (key: (typeof DRAFT_KEYS)[number]) => ({
    value: draft[key],
    onChange: (value: unknown) => patch({ [key]: value as SettingValue }),
  })

  return (
    <SettingsPage
      title='Invoicing'
      description='Configure automated invoice drafts and PDF defaults for completed jobs and visits.'
      breadcrumbs={breadcrumbs}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection
          icon={Receipt}
          title='Automation'
          description='Master switch and defaults for auto-generated invoice drafts.'>
          <FieldPanel className='mt-1 p-0' resizeId='invoicing-settings' defaultLabelWidth={220}>
            <SettingsFieldRow
              settingKey='documents.invoice.autoEnabled'
              title='Automatic invoicing'
              description='Generate invoice drafts automatically. Turning this off only stops automation — manual gather still works.'
              {...controlled('documents.invoice.autoEnabled')}
            />
            <SettingsFieldRow
              settingKey='documents.invoice.defaultTiming'
              title='Default invoice timing'
              description='What new quotes and jobs start as. A per-job timing setting always overrides this default.'
              {...controlled('documents.invoice.defaultTiming')}
            />
            <SettingsFieldRow
              settingKey='documents.invoice.dateBasis'
              title='Invoice date basis'
              description='Whether auto-generated invoices are dated to the visit or the day they were generated.'
              {...controlled('documents.invoice.dateBasis')}
            />
          </FieldPanel>
        </SettingsSection>

        <SettingsSection
          icon={FileText}
          title='Invoice PDF defaults'
          description='Defaults for invoice PDFs — these apply once invoicing ships (MI1); the settings save now so they are ready.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='invoicing-pdf-settings'
            defaultLabelWidth={220}>
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
