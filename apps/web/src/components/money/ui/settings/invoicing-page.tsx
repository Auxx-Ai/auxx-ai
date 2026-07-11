// apps/web/src/components/money/ui/settings/invoicing-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Lock, Receipt } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
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

  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Invoicing' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Invoicing'
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

  return (
    <SettingsPage
      title='Invoicing'
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
            />
            <SettingsFieldRow
              settingKey='documents.invoice.defaultTiming'
              title='Default invoice timing'
              description='What new quotes and jobs start as. A per-job timing setting always overrides this default.'
            />
            <SettingsFieldRow
              settingKey='documents.invoice.dateBasis'
              title='Invoice date basis'
              description='Whether auto-generated invoices are dated to the visit or the day they were generated.'
            />
          </FieldPanel>
        </SettingsSection>
      </div>
    </SettingsPage>
  )
}
