// apps/web/src/app/(protected)/app/files/page.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback, useEffect } from 'react'
import { FilesManagement } from '~/components/files'
import { FileDetailDrawer } from '~/components/files/file-detail-drawer'
import { type FileItem, useFileSystemStore } from '~/components/files/files-store'
import { EmptyState } from '~/components/global/empty-state'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

function FilesPageContent() {
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

  const { dockedPanels, overlays } = useDockedPanels(
    selectedFile
      ? [
          {
            key: 'file-detail',
            open: isDrawerOpen,
            content: (
              <FileDetailDrawer
                file={selectedFile}
                setSelectedFile={handleSetSelectedFile}
                onOpenChange={handleDrawerOpenChange}
              />
            ),
          },
        ]
      : []
  )

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Files' href='/app/files' />
          <MainPageBreadcrumbItem title='Management' />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent dockedPanels={dockedPanels}>
        <FilesManagement onFileSelect={handleFileSelect} />
      </MainPageContent>

      {overlays}
    </MainPage>
  )
}

export default function FilesPage() {
  const { hasAccess } = useFeatureFlags()
  const { can } = useAccess()

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

  // Layer-2 permission gate: the member holds the plan but not `files.view`.
  if (!can(PermissionKey.filesView)) {
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
            title='No Access to Files'
            description="You don't have permission to view files. Ask an admin for access."
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return <FilesPageContent />
}
