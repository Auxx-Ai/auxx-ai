// apps/web/src/components/money/ui/settings/quotes-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { getFileRefDownloadUrl, toFileRef } from '@auxx/types/file-ref'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Eye, FileCheck2, FileText, Lock } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/**
 * Quotes settings page (34-settings-reorg.md, NEW) — quote PDF defaults (moved from the old
 * Documents page) + quote acceptance/deposits (moved from the old "Invoicing & Quoting" page).
 * Plain form page, admin-gated, page-level {@link useDirtyDraft} + one bottom
 * {@link FormSaveBar} (10-settings-forms-unification.md).
 */
export function QuotesSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Quotes' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Quotes'
        description='Configure quote PDF defaults, online acceptance, and deposits.'
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

  return <QuotesSettingsBody breadcrumbs={breadcrumbs} />
}

/** Scalar catalog keys the Quotes draft owns (`DOCUMENTS` scope). */
const DRAFT_KEYS = [
  'documents.quote.defaultTerms',
  'documents.quote.validDays',
  'documents.quote.footerText',
  'documents.quote.lineDisplay',
  'documents.quote.showDescriptions',
  'documents.quote.acceptancePageEnabled',
  'documents.quote.allowDecline',
  'documents.quote.requireSignature',
  'documents.quote.autoConvertOnAccept',
  'documents.quote.depositType',
  'documents.quote.depositValue',
] as const

function QuotesSettingsBody({ breadcrumbs }: { breadcrumbs: { title: string }[] }) {
  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'DOCUMENTS',
  })

  // Rebuilt each render; `useDirtyDraft` compares by value so a fresh identity never reseeds.
  const server: Record<string, SettingValue> = {}
  for (const key of DRAFT_KEYS) server[key] = getSetting(key)

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
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

  const previewPdf = api.money.previewDocumentPdf.useMutation({
    onSuccess: (data) => {
      window.open(getFileRefDownloadUrl(toFileRef('asset', data.assetId)), '_blank')
    },
    onError: (error) =>
      toastError({ title: 'Failed to render preview', description: error.message }),
  })

  return (
    <SettingsPage
      title='Quotes'
      description='Configure quote PDF defaults, online acceptance, and deposits.'
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
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection
          icon={FileText}
          title='Quote PDF defaults'
          description='Defaults applied to new quotes and their PDFs.'>
          <FieldPanel className='mt-1 p-0' resizeId='quotes-settings' defaultLabelWidth={220}>
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
