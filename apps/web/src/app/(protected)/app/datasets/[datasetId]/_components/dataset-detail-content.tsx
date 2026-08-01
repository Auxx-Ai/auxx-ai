// apps/web/src/app/(protected)/app/datasets/[datasetId]/_components/dataset-detail-content.tsx

'use client'

import type { DocumentEntity as Document } from '@auxx/database/types'
import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { FileText, Search, Settings } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { DocumentDetailDrawer } from '~/components/datasets/documents/document-detail-drawer'
import { DocumentManagement } from '~/components/datasets/documents/document-management'
import { DatasetSearch } from '~/components/datasets/search/dataset-search'
import { DatasetSettings } from '~/components/datasets/settings/dataset-settings'
import { DatasetBreadcrumbSwitcher } from '~/components/datasets/ui/dataset-breadcrumb-switcher'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useAccess } from '~/providers/capabilities-provider'
import { DatasetActions } from './dataset-actions'
import { DATASET_TABS, useDatasetDetail } from './dataset-detail-provider'
import { DatasetHeader } from './dataset-header'

/**
 * DatasetDetailContent - main content for the dataset detail page.
 * Includes MainPage, dock logic, and drawer state management.
 */
export function DatasetDetailContent() {
  const { currentTab, setCurrentTab, dataset, documents } = useDatasetDetail()
  const { canAdminInstance } = useAccess()
  const canAdmin = dataset ? canAdminInstance(toRecordId('dataset', dataset.id)) : false

  // Drawer state — synced to URL via ?id= param
  const [selectedDocumentId, setSelectedDocumentId] = useQueryState(
    'id',
    parseAsString.withDefault('')
  )
  const isDrawerOpen = !!selectedDocumentId
  const selectedDocument = useMemo<Document | null>(
    () => documents.find((doc) => doc.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId]
  )

  /** Handle document selection from DocumentManagement */
  const handleDocumentSelect = useCallback(
    (document: Document) => {
      setSelectedDocumentId(document.id)
    },
    [setSelectedDocumentId]
  )

  /** Handle drawer close */
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setSelectedDocumentId(null)
    },
    [setSelectedDocumentId]
  )

  // Docked panel only shows when on the documents tab; overlay (non-docked)
  // mode shows regardless of tab, matching the pre-hook behavior.
  const { dockedPanels, overlays } = useDockedPanels(
    selectedDocument && dataset
      ? [
          {
            key: 'document-detail',
            open: { docked: isDrawerOpen && currentTab === 'documents', overlay: isDrawerOpen },
            content: (
              <DocumentDetailDrawer
                document={selectedDocument}
                open={isDrawerOpen}
                onOpenChange={handleDrawerOpenChange}
                datasetId={dataset.id}
              />
            ),
          },
        ]
      : []
  )

  if (!dataset) return null

  const processingCount = documents.filter((doc) => doc.status === 'PROCESSING').length
  const errorCount = documents.filter((doc) => doc.status === 'FAILED').length

  return (
    <MainPage>
      <MainPageHeader action={<DatasetActions />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Datasets' href='/app/datasets' />
          <DatasetBreadcrumbSwitcher activeDatasetId={dataset.id} activeLabel={dataset.name} />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent dockedPanels={dockedPanels}>
        <Tabs
          value={currentTab}
          onValueChange={(value) => {
            const next = DATASET_TABS.find((tab) => tab === value)
            if (next) setCurrentTab(next)
          }}
          className='flex-1 h-full flex flex-col'>
          <TabsList className='border-b w-full justify-start rounded-b-none bg-primary-150'>
            <TabsTrigger value='documents' variant='outline' size='sm'>
              <FileText />
              Documents
              {(processingCount > 0 || errorCount > 0) && (
                <div className='flex gap-1 shrink-0 ps-1'>
                  {processingCount > 0 && (
                    <Badge variant='secondary' size='xs'>
                      {processingCount}
                    </Badge>
                  )}
                  {errorCount > 0 && (
                    <Badge variant='destructive' size='xs'>
                      {errorCount}
                    </Badge>
                  )}
                </div>
              )}
            </TabsTrigger>
            <TabsTrigger value='search' variant='outline' size='sm'>
              <Search />
              Search
            </TabsTrigger>
            <TabsTrigger value='settings' variant='outline' size='sm'>
              <Settings />
              Settings
            </TabsTrigger>
          </TabsList>

          <DatasetHeader />
          <TabsContent value='documents'>
            <DocumentManagement datasetId={dataset.id} onDocumentSelect={handleDocumentSelect} />
          </TabsContent>

          <TabsContent value='search' className='min-h-0 h-auto'>
            <DatasetSearch datasetIds={[dataset.id]} />
          </TabsContent>

          <TabsContent value='settings' className='overflow-y-auto'>
            <DatasetSettings dataset={dataset} readOnly={!canAdmin} />
          </TabsContent>
        </Tabs>
      </MainPageContent>

      {overlays}
    </MainPage>
  )
}
