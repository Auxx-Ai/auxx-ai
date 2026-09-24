// apps/web/src/components/accounting/ui/settings/provider-settings-page.tsx
'use client'

// Accounting > Settings > Connected system (plans/accounting/tasks/27-the-
// connected-system-is-its-own-page.md §2).
//
// The three provider sections used to live in General's right-hand column, and
// each of them had independently written a comment explaining why it was exempt
// from that page's one organising mechanism - it owns no settings values, joins
// no `useDirtyDraft` slice, adds nothing to `DRAFT_KEYS`. Three sections that
// each have to explain their exemption are three sections on the wrong page.
//
// 🛑 ONE COLUMN, not two. The sections read in sequence and the sequence is the
// point: connect a system and bring across what makes the two sets of books
// agree, then ask whether they do (brief 20 §8.5 - after a sync of a period, the
// difference for that period should be zero). A grid would race them.
//
// 🛑 NO `FormSaveBar`. Nothing here is draft-backed. Every settings value on the
// page is an uncontrolled `SettingsFieldRow` that autosaves straight through.
//
// 🛑 This page is not a setup gate, and giving the provider its own page must
// never be read as promoting it to one. Decision `P1` makes "nothing connected"
// a first-class outcome, `setup-readiness.ts` has no provider requirement, and
// `getting-started.ts` deliberately carries no `connect-quickbooks` goal. All
// three still hold.

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { Lock } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { AccountingProviderSection } from './accounting-provider-section'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Connected system' },
]

const PAGE_DESCRIPTION =
  'The accounting system these books are mirrored to, and what to bring across from it.'

export function AccountingProviderSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage
        title='Connected system'
        description={PAGE_DESCRIPTION}
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Accounting Not Available'
          description='Upgrade your plan to keep books in Auxx.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title='Connected system' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      {/* `max-w-3xl`: at 1920px an unconstrained column puts a switch a screen's
          width away from the label that names it. */}
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <div className='flex max-w-3xl flex-col gap-8'>
          <AccountingProviderSection />
        </div>
      </div>
    </SettingsPage>
  )
}
