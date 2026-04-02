// apps/web/src/app/(protected)/app/datasets/[datasetId]/_components/dataset-detail-content.tsx

'use client'

import type { DocumentEntity as Document } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import {
  type DockedPanelConfig,
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { FileText, Search, Settings } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { DocumentDetailDrawer } from '~/components/datasets/documents/document-detail-drawer'
import { DocumentManagement } from '~/components/datasets/documents/document-management'
import { DatasetSearch } from '~/components/datasets/search/dataset-search'
import { DatasetSettings } from '~/components/datasets/settings/dataset-settings'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { DatasetActions } from './dataset-actions'
import { useDatasetDetail } from './dataset-detail-provider'
import { DatasetHeader } from './dataset-header'

/**
 * DatasetDetailContent - main content for the dataset detail page.
 * Includes MainPage, dock logic, and drawer state management.
 */
export function DatasetDetailContent() {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)
  const { currentTab, setCurrentTab, dataset, documents } = useDatasetDetail()

  // Drawer state
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  /** Handle document selection from DocumentManagement */
  const handleDocumentSelect = useCallback((document: Document) => {
    setSelectedDocument(document)
    setIsDrawerOpen(true)
  }, [])

  /** Handle drawer close */
  const handleDrawerOpenChange = useCallback((open: boolean) => {
    setIsDrawerOpen(open)
    if (!open) setSelectedDocument(null)
  }, [])

  // Build docked panels - only show when on documents tab
  const dockedPanels = useMemo<DockedPanelConfig[]>(() => {
    if (!isDocked || !isDrawerOpen || !selectedDocument || !dataset || currentTab !== 'documents')
      return []
    return [
      {
        key: 'document-detail',
        content: (
          <DocumentDetailDrawer
            document={selectedDocument}
            open={isDrawerOpen}
            onOpenChange={handleDrawerOpenChange}
            datasetId={dataset.id}
          />
        ),
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth,
        maxWidth,
      },
    ]
  }, [
    isDocked,
    isDrawerOpen,
    selectedDocument,
    currentTab,
    dataset,
    handleDrawerOpenChange,
    dockedWidth,
    setDockedWidth,
    minWidth,
    maxWidth,
  ])

  if (!dataset) return null

  const processingCount = documents.filter((doc) => doc.status === 'PROCESSING').length
  const errorCount = documents.filter((doc) => doc.status === 'FAILED').length

  return (
    <MainPage>
      <MainPageHeader action={<DatasetActions />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Datasets' href='/app/datasets' />
          <MainPageBreadcrumbItem title='Dataset Details' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent dockedPanels={dockedPanels}>
        <Tabs
          value={currentTab}
          onValueChange={setCurrentTab}
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
            <DatasetSettings dataset={dataset} />
          </TabsContent>
        </Tabs>

        {/* Overlay drawer when NOT docked */}
        {!isDocked && selectedDocument && isDrawerOpen && (
          <DocumentDetailDrawer
            document={selectedDocument}
            open={isDrawerOpen}
            onOpenChange={handleDrawerOpenChange}
            datasetId={dataset.id}
          />
        )}
      </MainPageContent>
    </MainPage>
  )
}
