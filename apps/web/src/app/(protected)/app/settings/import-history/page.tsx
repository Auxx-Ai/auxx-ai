// apps/web/src/app/(protected)/app/settings/import-history/page.tsx

import { Import } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import { ImportHistoryOverview } from './_components/import-history-overview'

/**
 * Import history settings page.
 * Shows all past import jobs with ability to resume or delete.
 */
export default function ImportHistoryPage() {
  return (
    <SettingsPage
      icon={<Import />}
      title='Import History'
      description='View and manage your data imports'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Import History' }]}>
      <ImportHistoryOverview />
    </SettingsPage>
  )
}
