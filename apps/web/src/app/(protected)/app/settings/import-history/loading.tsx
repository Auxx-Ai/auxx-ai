// apps/web/src/app/(protected)/app/settings/import-history/loading.tsx

import { Skeleton } from '@auxx/ui/components/skeleton'
import React from 'react'
import SettingsPage from '~/components/global/settings-page'

/**
 * Loading state for import history page.
 */
export default function ImportHistoryLoading() {
  return (
    <SettingsPage title='Import History'>
      <div className='p-6 space-y-4'>
        <div className='flex items-center gap-4'>
          <Skeleton className='h-9 flex-1' />
          <Skeleton className='h-9 w-32' />
        </div>
        <div className='space-y-3'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-16 rounded-2xl' />
          ))}
        </div>
      </div>
    </SettingsPage>
  )
}
