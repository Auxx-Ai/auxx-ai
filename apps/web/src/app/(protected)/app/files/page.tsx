// apps/web/src/app/(protected)/app/files/page.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useCallback, useState } from 'react'
import { FilesManagement } from '~/components/files'
import { FileDetailDrawer } from '~/components/files/file-detail-drawer'
import type { FileItem } from '~/components/files/files-store'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'

function FilesPageContent() {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Drawer state
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  /** Handle file selection from FilesManagement */
  const handleFileSelect = useCallback((file: FileItem) => {
    setSelectedFile(file)
    setIsDrawerOpen(true)
  }, [])

  /** Handle drawer close */
  const handleDrawerOpenChange = useCallback((open: boolean) => {
    setIsDrawerOpen(open)
    if (!open) setSelectedFile(null)
  }, [])

  // Build docked panel content
  const dockedPanel =
    isDocked && isDrawerOpen && selectedFile ? (
      <FileDetailDrawer
        file={selectedFile}
        setSelectedFile={setSelectedFile}
        onOpenChange={handleDrawerOpenChange}
      />
    ) : undefined

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Files' href='/app/files' />
          <MainPageBreadcrumbItem title='Management' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent
        dockedPanel={dockedPanel}
        dockedPanelWidth={dockedWidth}
        onDockedPanelWidthChange={setDockedWidth}
        dockedPanelMinWidth={minWidth}
        dockedPanelMaxWidth={maxWidth}>
        <FilesManagement onFileSelect={handleFileSelect} />

        {/* Overlay drawer when NOT docked */}
        {!isDocked && selectedFile && isDrawerOpen && (
          <FileDetailDrawer
            file={selectedFile}
            setSelectedFile={setSelectedFile}
            onOpenChange={handleDrawerOpenChange}
          />
        )}
      </MainPageContent>
    </MainPage>
  )
}

export default function FilesPage() {
  return <FilesPageContent />
}
