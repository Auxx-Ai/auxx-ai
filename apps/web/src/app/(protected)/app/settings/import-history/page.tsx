// apps/web/src/app/(protected)/app/settings/import-history/page.tsx

import { ArrowLeftRight } from 'lucide-react'
import { ExportsSection } from '~/components/data-export/ui/exports-section'
import { ImportsSection } from '~/components/data-import/ui/imports-section'
import { AdminPageGuard } from '~/components/global/admin-page-guard'
import SettingsPage from '~/components/global/settings-page'

/**
 * Import & Export history page. Lists past imports (top) and CSV exports (bottom) as
 * read-only histories — transfers are started from entity pages / the table toolbar.
 * See plans/exporter/04-history-page-plan.md.
 */
export default function ImportExportHistoryPage() {
  return (
    <SettingsPage
      icon={<ArrowLeftRight />}
      title='Import & Export'
      description='View your data imports and exports'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Import & Export' }]}>
      <AdminPageGuard />
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <ImportsSection />
        <ExportsSection />
      </div>
    </SettingsPage>
  )
}
