// apps/web/src/components/money/ui/settings/invoicing-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { cn } from '@auxx/ui/lib/utils'
import { CreditCard, FileCheck2, Lock, Receipt } from 'lucide-react'
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
 * Invoicing settings page (money MI2 build spec §O.3) — the master switch,
 * default timing, and date basis for automated invoice drafts. Admin-gated,
 * plain form page (availability-page recipe): one `useSettings({scope:
 * 'DOCUMENTS'})` instance via `SettingsFieldRow`, no tabs.
 *
 * `defaultTiming` also write-throughs onto the two `quote_invoice_timing`/
 * `work_order_invoice_timing` `CustomField.defaultValue` rows on save — see
 * `packages/lib/src/settings/settings-service.ts` (`updateOrganizationSetting`).
 */
export function InvoicingSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Invoicing & Quoting' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Invoicing & Quoting'
        description='Configure automated invoice drafts for completed jobs and visits.'
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

/** Scalar catalog keys the Invoicing & Quoting draft owns. */
const DRAFT_KEYS = [
  'documents.invoice.autoEnabled',
  'documents.invoice.defaultTiming',
  'documents.invoice.dateBasis',
  'documents.invoice.allowPartialPayments',
  'documents.invoice.partialPaymentMinPercent',
  'documents.quote.acceptancePageEnabled',
  'documents.quote.allowDecline',
  'documents.quote.requireSignature',
  'documents.quote.autoConvertOnAccept',
  'documents.quote.depositType',
  'documents.quote.depositValue',
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

  const acceptancePageEnabled = !!draft['documents.quote.acceptancePageEnabled']
  const allowPartialPayments = !!draft['documents.invoice.allowPartialPayments']

  return (
    <SettingsPage
      title='Invoicing & Quoting'
      description='Configure automated invoice drafts for completed jobs and visits.'
      breadcrumbs={breadcrumbs}>
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
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
          icon={CreditCard}
          title='Partial payments'
          description='Let customers pay a custom amount on the public pay page instead of only the full balance.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='partial-payments-settings'
            defaultLabelWidth={220}>
            <SettingsFieldRow
              settingKey='documents.invoice.allowPartialPayments'
              title='Allow partial payments'
              description='Applies to invoice payments; deposits are always paid in full.'
              {...controlled('documents.invoice.allowPartialPayments')}
            />
            <div
              className={cn(
                'flex flex-col',
                !allowPartialPayments && 'pointer-events-none opacity-50'
              )}>
              <SettingsFieldRow
                settingKey='documents.invoice.partialPaymentMinPercent'
                title='Minimum payment percent'
                description='Smallest payment a customer can submit, as a percent of the current balance.'
                {...controlled('documents.invoice.partialPaymentMinPercent')}
              />
            </div>
          </FieldPanel>
        </SettingsSection>

        <SettingsSection
          icon={FileCheck2}
          title='Quote acceptance'
          description='Configure the customer-facing quote acceptance page and what happens when a customer accepts.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='quote-acceptance-settings'
            defaultLabelWidth={220}>
            <SettingsFieldRow
              settingKey='documents.quote.acceptancePageEnabled'
              title='Online quote acceptance page'
              description='Let customers view and accept or decline quotes from a public link included in the quote email.'
              {...controlled('documents.quote.acceptancePageEnabled')}
            />
            <div
              className={cn(
                'flex flex-col',
                !acceptancePageEnabled && 'pointer-events-none opacity-50'
              )}>
              <SettingsFieldRow
                settingKey='documents.quote.allowDecline'
                title='Allow customers to decline'
                description='Show a Decline option on the quote acceptance page.'
                {...controlled('documents.quote.allowDecline')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.requireSignature'
                title='Require typed signature to accept'
                description='Require the customer to type their name to confirm acceptance.'
                {...controlled('documents.quote.requireSignature')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.autoConvertOnAccept'
                title='Convert to job on acceptance'
                description='Automatically convert the quote to a work order when the customer accepts.'
                {...controlled('documents.quote.autoConvertOnAccept')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.depositType'
                title='Deposit type'
                description="Org default deposit required to accept a quote — a quote's own deposit fields override this. None = no deposit requested."
                {...controlled('documents.quote.depositType')}
              />
              <SettingsFieldRow
                settingKey='documents.quote.depositValue'
                title='Deposit value'
                description='Percent (0-100) or a fixed currency amount (50 = $50.00), depending on deposit type.'
                {...controlled('documents.quote.depositValue')}
              />
            </div>
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
