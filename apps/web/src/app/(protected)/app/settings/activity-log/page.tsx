// apps/web/src/app/(protected)/app/settings/activity-log/page.tsx
// Org-admin "Account Activity" route. Owns the filter state so the SettingsPage header
// export button and the activity view share one source of truth. Access is enforced by
// the auditLog.list adminProcedure; the nav item is gated to ADMIN.

'use client'

import type { AuditCategory } from '@auxx/lib/audit-log/client'
import type { DateRange } from '@auxx/ui/components/date-range-picker'
import { addDays, endOfDay, startOfDay } from 'date-fns'
import { useMemo, useState } from 'react'
import type { AuditFeedFilters } from '~/components/activity-log/hooks/use-audit-feed'
import { ActivityLogView } from '~/components/activity-log/ui/activity-log-view'
import { AuditExportButton } from '~/components/activity-log/ui/audit-export-button'
import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'

export default function ActivityLogPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const [category, setCategory] = useState<string>('all')
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: startOfDay(addDays(new Date(), -7)),
    to: endOfDay(new Date()),
  }))

  const filters = useMemo<AuditFeedFilters>(
    () => ({
      category: category === 'all' ? undefined : (category as AuditCategory),
      from: dateRange.from ? startOfDay(dateRange.from) : undefined,
      to: dateRange.to ? endOfDay(dateRange.to) : undefined,
    }),
    [category, dateRange]
  )

  return (
    <SettingsPage
      title='Account Activity'
      description='Security & account events for your organization'
      breadcrumbs={[{ title: 'Settings', href: '/settings' }, { title: 'Account Activity' }]}
      button={<AuditExportButton scope='org' filters={filters} />}>
      <ActivityLogView
        filters={filters}
        category={category}
        onCategoryChange={setCategory}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />
    </SettingsPage>
  )
}
