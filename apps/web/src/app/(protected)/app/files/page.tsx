// apps/web/src/app/(protected)/app/files/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  type DockedPanelConfig,
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo } from 'react'
import { FilesManagement } from '~/components/files'
import { FileDetailDrawer } from '~/components/files/file-detail-drawer'
import { type FileItem, useFileSystemStore } from '~/components/files/files-store'
import { EmptyState } from '~/components/global/empty-state'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useDockStore } from '~/stores/dock-store'

function FilesPageContent() {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // ── URL state ───────────────────────────────────────────────────────────
  // ?folder=<folderId> mirrors the filesystem store's currentFolderId
  // ?id=<fileId> opens the file detail drawer
  const [folderId, setFolderId] = useQueryState('folder', parseAsString.withDefault(''))
  const [selectedFileId, setSelectedFileId] = useQueryState('id', parseAsString.withDefault(''))

  // ── Bidirectional sync between ?folder= and store.currentFolderId ───────
  // URL → store: applies on mount and any URL change.
  const setCurrentFolder = useFileSystemStore((s) => s.setCurrentFolder)
  const storeCurrentFolderId = useFileSystemStore((s) => s.currentFolderId)
  useEffect(() => {
    const target = folderId || null
    if (storeCurrentFolderId !== target) {
      setCurrentFolder(target)
    }
  }, [folderId, storeCurrentFolderId, setCurrentFolder])

  // Store → URL: when in-page navigation (breadcrumbs, folder click) updates
  // the store, mirror the change into the URL so deep-links and back/forward work.
  useEffect(() => {
    return useFileSystemStore.subscribe(
      (s) => s.currentFolderId,
      (next, prev) => {
        if (next === prev) return
        setFolderId(next ?? null)
      }
    )
  }, [setFolderId])

  // Look up the selected FileItem from the store
  const selectedFile = useFileSystemStore((s) => {
    if (!selectedFileId) return null
    return s.itemsById.get(selectedFileId) ?? null
  })

  const isDrawerOpen = !!selectedFileId && !!selectedFile

  /** Selecting a file from the table writes to ?id= */
  const handleFileSelect = useCallback(
    (file: FileItem) => {
      setSelectedFileId(file.id)
    },
    [setSelectedFileId]
  )

  /** Closing the drawer clears ?id= */
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setSelectedFileId(null)
    },
    [setSelectedFileId]
  )

  /** FileDetailDrawer can switch which file it shows (e.g. next/prev). */
  const handleSetSelectedFile = useCallback(
    (file: FileItem | null) => {
      setSelectedFileId(file?.id ?? null)
    },
    [setSelectedFileId]
  )

  // Build docked panels
  const dockedPanels = useMemo<DockedPanelConfig[]>(() => {
    if (!isDocked || !isDrawerOpen || !selectedFile) return []
    return [
      {
        key: 'file-detail',
        content: (
          <FileDetailDrawer
            file={selectedFile}
            setSelectedFile={handleSetSelectedFile}
            onOpenChange={handleDrawerOpenChange}
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
    selectedFile,
    handleDrawerOpenChange,
    handleSetSelectedFile,
    dockedWidth,
    setDockedWidth,
    minWidth,
    maxWidth,
  ])

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Files' href='/app/files' />
          <MainPageBreadcrumbItem title='Management' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent dockedPanels={dockedPanels}>
        <FilesManagement onFileSelect={handleFileSelect} />

        {/* Overlay drawer when NOT docked */}
        {!isDocked && selectedFile && isDrawerOpen && (
          <FileDetailDrawer
            file={selectedFile}
            setSelectedFile={handleSetSelectedFile}
            onOpenChange={handleDrawerOpenChange}
          />
        )}
      </MainPageContent>
    </MainPage>
  )
}

export default function FilesPage() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.files)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Files' href='/app/files' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Files Not Available'
            description='Upgrade your plan to access file management.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return <FilesPageContent />
}
