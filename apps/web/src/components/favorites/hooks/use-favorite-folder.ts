// apps/web/src/components/favorites/hooks/use-favorite-folder.ts
'use client'

import { useFileSystemStore } from '~/components/files/files-store'
import { useFilesystemContext } from '~/components/files/provider/filesystem-provider'

/**
 * Resolve a favorited folder from the app-wide FilesystemProvider store.
 * Avoids a per-favorite tRPC call — the filesystem is already loaded globally.
 */
export function useFavoriteFolder(folderId: string | null | undefined) {
  const { isLoading } = useFilesystemContext()
  const folder = useFileSystemStore((s) => {
    if (!folderId) return null
    const item = s.itemsById.get(folderId)
    return item?.type === 'folder' ? item : null
  })

  const isNotFound = !!folderId && !isLoading && !folder
  return { folder, isLoading: !!folderId && isLoading && !folder, isNotFound }
}
