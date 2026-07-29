// apps/web/src/components/dispatch/ui/number-formats-page.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { Lock } from 'lucide-react'
import TicketNumberingSettings from '~/app/(protected)/app/tickets/_components/ticket-number-form'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'Number Formats' }]

/**
 * Dispatch Number Formats settings page (04-ui.md §9, 07-m2-build.md §E.2): the ticket
 * numbering form generalized over `RecordSequence` scopes — two instances here (work orders,
 * requests); money later adds QUO/INV scopes to this same page. Ticket numbering itself stays
 * at `tickets/settings/format` with `scope='ticket'`.
 */
export function NumberFormatsPage() {
  useRequireCapability(PermissionKey.settingsManage)
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Number Formats'
        description='Configure how work order and request numbers are generated.'
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

  return (
    <SettingsPage
      title='Number Formats'
      description='Configure how work order and request numbers are generated.'
      breadcrumbs={BREADCRUMBS}>
      <div className='grid grid-cols-1 items-start gap-8 p-3 sm:p-6 lg:grid-cols-2'>
        <TicketNumberingSettings
          scope='work_order'
          title='Work Orders'
          description='Configure how work order numbers are generated.'
          className=''
        />
        <TicketNumberingSettings
          scope='service_request'
          title='Requests'
          description='Configure how service request numbers are generated.'
          className=''
        />
      </div>
    </SettingsPage>
  )
}
