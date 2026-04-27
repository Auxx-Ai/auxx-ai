// apps/web/src/components/favorites/hooks/use-favorite-file.ts
'use client'

import { useFileSystemStore } from '~/components/files/files-store'
import { useFilesystemContext } from '~/components/files/provider/filesystem-provider'

/**
 * Resolve a favorited file from the app-wide FilesystemProvider store.
 * Avoids a per-favorite tRPC call — the filesystem is already loaded globally.
 */
export function useFavoriteFile(fileId: string | null | undefined) {
  const { isLoading } = useFilesystemContext()
  const file = useFileSystemStore((s) => {
    if (!fileId) return null
    const item = s.itemsById.get(fileId)
    return item?.type === 'file' ? item : null
  })

  const isNotFound = !!fileId && !isLoading && !file
  return { file, isLoading: !!fileId && isLoading && !file, isNotFound }
}
