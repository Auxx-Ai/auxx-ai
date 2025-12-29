// apps/web/src/components/file-select/file-select-wrapper.tsx

'use client'

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useFileSystemStore } from '~/components/files/files-store'
import { keepPreviousData } from '@tanstack/react-query'

/**
 * Wrapper component that ensures filesystem data is loaded into the store
 * This solves the provider isolation issue by loading data directly
 */
export function FileSelectWrapper({ children }: { children: React.ReactNode }) {
  const setFileSystemData = useFileSystemStore((state) => state.setFileSystemData)
  
  // Load filesystem data directly into store, bypassing context
  const { data: fileSystemData } = api.file.getFileSystem.useInfiniteQuery(
    {
      filesLimit: 500,
      includeArchived: false,
    },
    {
      enabled: true,
      placeholderData: keepPreviousData,
      getNextPageParam: (lastPage) => lastPage.filesNextCursor,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 3 * 60 * 1000,
      cacheTime: 10 * 60 * 1000,
    }
  )
  
  // Update store when data changes
  useEffect(() => {
    if (!fileSystemData?.pages?.length) return
    
    const allItems = fileSystemData.pages.flatMap((p) => p.items || [])
    if (allItems.length > 0) {
      console.log('[FileSelectWrapper] Loading', allItems.length, 'items into store')
      setFileSystemData(allItems)
    }
  }, [fileSystemData?.pages, setFileSystemData])
  
  return <>{children}</>
}