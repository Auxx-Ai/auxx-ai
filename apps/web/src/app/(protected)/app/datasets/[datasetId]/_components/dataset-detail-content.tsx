// apps/web/src/app/(protected)/app/datasets/[datasetId]/_components/dataset-detail-content.tsx

'use client'

import { useState, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Badge } from '@auxx/ui/components/badge'
import { FileText, Search, Settings } from 'lucide-react'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useDatasetDetail } from './dataset-detail-provider'
import { DocumentManagement } from '~/components/datasets/documents/document-management'
import { DocumentDetailDrawer } from '~/components/datasets/documents/document-detail-drawer'
import { DatasetSearch } from '~/components/datasets/search/dataset-search'
import { DatasetSettings } from '~/components/datasets/settings/dataset-settings'
import { DatasetHeader } from './dataset-header'
import { DatasetActions } from './dataset-actions'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import type { DocumentEntity as Document } from '@auxx/database/models'

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

  if (!dataset) return null

  const processingCount = documents.filter((doc) => doc.status === 'PROCESSING').length
  const errorCount = documents.filter((doc) => doc.status === 'FAILED').length

  // Build docked panel - only show when on documents tab
  const dockedPanel =
    isDocked && isDrawerOpen && selectedDocument && currentTab === 'documents' ? (
      <DocumentDetailDrawer
        document={selectedDocument}
        open={isDrawerOpen}
        onOpenChange={handleDrawerOpenChange}
        datasetId={dataset.id}
      />
    ) : undefined

  return (
    <MainPage>
      <MainPageHeader action={<DatasetActions />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title="Datasets" href="/app/datasets" />
          <MainPageBreadcrumbItem title="Dataset Details" last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent
        dockedPanel={dockedPanel}
        dockedPanelWidth={dockedWidth}
        onDockedPanelWidthChange={setDockedWidth}
        dockedPanelMinWidth={minWidth}
        dockedPanelMaxWidth={maxWidth}>
        <Tabs
          value={currentTab}
          onValueChange={setCurrentTab}
          className="flex-1 h-full flex flex-col">
          <TabsList className="border-b w-full justify-start rounded-b-none bg-primary-150">
            <TabsTrigger value="documents" variant="outline" size="sm">
              <FileText />
              Documents
              {(processingCount > 0 || errorCount > 0) && (
                <div className="flex gap-1 shrink-0 ps-1">
                  {processingCount > 0 && (
                    <Badge variant="secondary" size="xs">
                      {processingCount}
                    </Badge>
                  )}
                  {errorCount > 0 && (
                    <Badge variant="destructive" size="xs">
                      {errorCount}
                    </Badge>
                  )}
                </div>
              )}
            </TabsTrigger>
            <TabsTrigger value="search" variant="outline" size="sm">
              <Search />
              Search
            </TabsTrigger>
            <TabsTrigger value="settings" variant="outline" size="sm">
              <Settings />
              Settings
            </TabsTrigger>
          </TabsList>

          <DatasetHeader />
          <TabsContent value="documents">
            <DocumentManagement datasetId={dataset.id} onDocumentSelect={handleDocumentSelect} />
          </TabsContent>

          <TabsContent value="search" className="min-h-0 h-auto">
            <DatasetSearch datasetIds={[dataset.id]} />
          </TabsContent>

          <TabsContent value="settings" className="overflow-y-auto">
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
