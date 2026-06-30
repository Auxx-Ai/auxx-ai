// apps/web/src/app/(protected)/app/connectors/page.tsx

'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { ListPageScroll } from '@auxx/ui/components/list-page-scroll'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { ConnectorList } from '~/components/data-connectors/ui/connector-list'
import { ConnectorsBulkBar } from '~/components/data-connectors/ui/connectors-bulk-bar'
import { ConnectorsToolbar } from '~/components/data-connectors/ui/connectors-toolbar'
import { SourceTemplateDialog } from '~/components/data-connectors/ui/source-template-dialog'
import { EmptyState } from '~/components/global/empty-state'
import { ListSelectionProvider } from '~/components/list-selection'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Connectors index — the list view (card grid + "Connect a source" picker).
 * See plans/data-connectors/claude/05-frontend.md §1.
 */
export default function ConnectorsPage() {
  const { hasAccess } = useFeatureFlags()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const canConnect = hasAccess(FeatureKey.dataConnectors)

  return (
    <MainPage>
      <MainPageHeader
        action={
          canConnect ? (
            <Button size='sm' onClick={() => setPickerOpen(true)}>
              <Plus />
              Connect a source
            </Button>
          ) : undefined
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        {canConnect ? (
          <ListSelectionProvider>
            <ListPageScroll
              toolbar={<ConnectorsToolbar search={search} onSearchChange={setSearch} />}
              bodyClassName='flex-1 flex flex-col min-h-0'>
              <ConnectorList onConnect={() => setPickerOpen(true)} search={search} />
            </ListPageScroll>
            <ConnectorsBulkBar />
          </ListSelectionProvider>
        ) : (
          <EmptyState
            icon={Lock}
            title='Connectors Not Available'
            description='Upgrade your plan to use data connectors.'
            button={<div className='h-12' />}
          />
        )}
      </MainPageContent>
      <SourceTemplateDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </MainPage>
  )
}
