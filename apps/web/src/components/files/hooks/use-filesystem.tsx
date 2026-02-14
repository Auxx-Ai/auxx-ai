// apps/web/src/components/files/hooks/use-filesystem.tsx

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFileUpload } from '~/components/file-upload/hooks/use-file-upload'
import { useUploadStore } from '~/components/file-upload/stores'
import { api } from '~/trpc/react'
import { type FileItem, type FolderTreeNode, useFileSystemStore } from '../files-store'

/** Stable empty arrays to prevent unnecessary re-renders */
const EMPTY_IDS: string[] = []
const EMPTY_ITEMS: FileItem[] = []
const EMPTY_TREE: FolderTreeNode[] = []

/**
 * Merge server files with upload files, preventing flickering during transitions.
 *
 * Core principle: Keep upload files visible until replaced by server data.
 * This eliminates the gap that causes flickering between upload completion and server response.
 */
function mergeFileItems(serverFiles: FileItem[], uploadFiles: FileItem[]): FileItem[] {
  // Create composite key for matching: parentId:name:size
  const makeKey = (file: FileItem) =>
    `${file.parentId || 'root'}:${file.name}:${file.displaySize || file.size}`

  // Build server file map for O(1) lookups
  const serverMap = new Map(serverFiles.map((file) => [makeKey(file), file]))

  // Track which server files were matched
  const matchedServerKeys = new Set<string>()

  // Process upload files
  const mergedUploads = uploadFiles.map((uploadFile) => {
    const key = makeKey(uploadFile)
    const serverFile = serverMap.get(key)

    if (serverFile) {
      // Server file exists - use it, mark as matched
      matchedServerKeys.add(key)
      return {
        ...serverFile,
        // Preserve any UI state from upload (like progress animation)
        isTransitioning: uploadFile.status === 'completed',
      } as FileItem
    }

    // No server match yet - keep upload file visible
    return uploadFile
  })

  // Add server files that weren't matched (new files from other sources)
  const unmatchedServerFiles = serverFiles.filter((file) => !matchedServerKeys.has(makeKey(file)))

  return [...mergedUploads, ...unmatchedServerFiles]
}

/**
 * Enhanced filesystem hook with Maps-first bulk loading
 *
 * Complete rewrite using Maps for O(1) performance throughout.
 * Replaces multiple API calls with a single optimized query.
 */
export function useFilesystem() {
  // React Query utils for optimistic updates
  const utils = api.useUtils()
  const movingIdsRef = useRef<Set<string>>(new Set())
  const setMovingIds = (s: Set<string>) => {
    movingIdsRef.current = s
  }

  // Use specific selectors to avoid unnecessary re-renders
  const setFileSystemData = useFileSystemStore((state) => state.setFileSystemData)
  const setBreadcrumbs = useFileSystemStore((state) => state.setBreadcrumbs)
  const getItemPath = useFileSystemStore((state) => state.getItemPath)
  const setCurrentFolder = useFileSystemStore((state) => state.setCurrentFolder)
  const getItemChildren = useFileSystemStore((state) => state.getItemChildren)
  const getItemDescendants = useFileSystemStore((state) => state.getItemDescendants)
  const selectItems = useFileSystemStore((state) => state.selectItems)
  const unselectItems = useFileSystemStore((state) => state.unselectItems)
  const toggleItemSelection = useFileSystemStore((state) => state.toggleItemSelection)
  const clearSelection = useFileSystemStore((state) => state.clearSelection)
  const setSelectedItems = useFileSystemStore((state) => state.setSelectedItems)
  const setIsLoading = useFileSystemStore((state) => state.setIsLoading)
  const removeItems = useFileSystemStore((state) => state.removeItems)
  const updateItem = useFileSystemStore((state) => state.updateItem)
  const setViewMode = useFileSystemStore((state) => state.setViewMode)
  const setSorting = useFileSystemStore((state) => state.setSorting)
  const setFilterSettings = useFileSystemStore((state) => state.setFilterSettings)
  const addUploadingItems = useFileSystemStore((state) => state.addUploadingItems)
  const updateUploadProgress = useFileSystemStore((state) => state.updateUploadProgress)
  const removeCompletedUploads = useFileSystemStore((state) => state.removeCompletedUploads)
  // Upload store integration
  const uploadFiles = useUploadStore((state) => state.files)
  const activeSessionId = useUploadStore((state) => state.activeSessionId)
  const sessions = useUploadStore((state) => state.sessions)

  // SINGLE UNIFIED API CALL - replaces 4 separate queries
  const {
    data: fileSystemData,
    fetchNextPage,
    hasNextPage,
    isFetching,
    refetch: refetchFileSystem,
    error: fileSystemError,
  } = api.file.getFileSystem.useInfiniteQuery(
    {
      filesLimit: 500, // Load more files per request for better performance
      includeArchived: false,
    },
    {
      enabled: true,
      placeholderData: keepPreviousData,
      getNextPageParam: (lastPage) => lastPage.filesNextCursor,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 3 * 60 * 1000, // 3 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    }
  )

  // Update store when filesystem data changes - idempotent write to avoid render loops
  const flatIds = useMemo(() => {
    if (!fileSystemData?.pages?.length) return ''
    return fileSystemData.pages
      .flatMap((p) => p.items || [])
      .map((i) => i.id)
      .join('|')
  }, [fileSystemData?.pages])

  const lastIdsRef = useRef('')
  useEffect(() => {
    if (!fileSystemData?.pages?.length) return
    if (flatIds === lastIdsRef.current) return

    lastIdsRef.current = flatIds
    const allItems = fileSystemData.pages.flatMap((p) => p.items || [])

    // Debug: Check if optimistic data is flowing through
    const optimisticItems = allItems.filter((item) => item.isOptimisticMove)

    setFileSystemData(allItems)
  }, [fileSystemData?.pages, flatIds, setFileSystemData])

  // Update breadcrumbs when current folder changes - O(log n) with Maps
  const currentFolderId = useFileSystemStore((state) => state.currentFolderId)
  useEffect(() => {
    if (!currentFolderId) {
      setBreadcrumbs([{ id: null, name: 'Files', path: '/' }])
      return
    }

    // O(log n) path traversal instead of O(n) search
    const path = getItemPath(currentFolderId)
    const breadcrumbs = [
      { id: null, name: 'Files', path: '/' },
      ...path.map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
      })),
    ]
    setBreadcrumbs(breadcrumbs)
  }, [currentFolderId, getItemPath, setBreadcrumbs])

  // Get store state that affects item computation
  const itemsById = useFileSystemStore((state) => state.itemsById)
  const filesByParent = useFileSystemStore((state) => state.filesByParent)
  const foldersByParent = useFileSystemStore((state) => state.foldersByParent)
  const showUploading = useFileSystemStore((state) => state.showUploading)
  const selectedItemIds = useFileSystemStore((state) => state.selectedItemIds)
  const breadcrumbs = useFileSystemStore((state) => state.breadcrumbs)
  const folderTreeById = useFileSystemStore((state) => state.folderTreeById)
  // Don't use store's hierarchicalItems directly - need to integrate uploads
  // const hierarchicalItems = useFileSystemStore((state) => state.hierarchicalItems)
  const isLoading = useFileSystemStore((state) => state.isLoading)
  const viewMode = useFileSystemStore((state) => state.viewMode)
  const sortBy = useFileSystemStore((state) => state.sortBy)
  const sortOrder = useFileSystemStore((state) => state.sortOrder)
  const filterSettings = useFileSystemStore((state) => state.filterSettings)

  // Derive arrays from base state with stable empty fallbacks
  const selectedItems = useMemo(() => {
    if (selectedItemIds.size === 0) return EMPTY_ITEMS
    return Array.from(selectedItemIds)
      .map((id) => itemsById.get(id))
      .filter(Boolean) as FileItem[]
  }, [selectedItemIds, itemsById])

  const allFileIds = useMemo(() => {
    const ids = Array.from(itemsById.keys()).filter((id) => itemsById.get(id)?.type === 'file')
    return ids.length === 0 ? EMPTY_IDS : ids
  }, [itemsById])

  const allFolderIds = useMemo(() => {
    const ids = Array.from(itemsById.keys()).filter((id) => itemsById.get(id)?.type === 'folder')
    return ids.length === 0 ? EMPTY_IDS : ids
  }, [itemsById])

  const folderTree = useMemo(() => {
    if (folderTreeById.size === 0) return EMPTY_TREE
    return Array.from(folderTreeById.values())
  }, [folderTreeById])

  // File upload integration for FILE entity type
  const upload = useFileUpload({
    entityType: 'FILE',
    entityId: currentFolderId || undefined, // Current folder or undefined for root
    autoStart: false, // Manual control
    onComplete: (results) => {
      // Refresh file system to show new files
      refetchFileSystem()
    },
    onError: (error) => {
      toastError({ title: 'Upload failed', description: error })
    },
  })

  // Computed items based on current state - all O(1) operations with Maps
  const items = useMemo(() => {
    // Get current folder items manually instead of using getter
    const fileIds = filesByParent.get(currentFolderId) || []
    const folderIds = foldersByParent.get(currentFolderId) || []

    const baseItems = [...fileIds, ...folderIds]
      .map((id) => itemsById.get(id))
      .filter(Boolean) as FileItem[]

    // Add uploading files if enabled (no conversion needed - assume upload files are already FileItem format)
    if (!showUploading || !activeSessionId) {
      return baseItems
    }

    // Add current folder's uploading files
    const session = sessions[activeSessionId]
    const currentFolderUploads =
      session?.fileIds
        .map((fileId) => uploadFiles[fileId])
        .filter(Boolean)
        .filter((file) => {
          // Only show uploads for current folder
          // Check both metadata.targetFolderId and parentId for compatibility
          const uploadFolderId = file.metadata?.targetFolderId ?? file.parentId ?? null
          return uploadFolderId === currentFolderId
        }) || []
    // No conversion needed - files are already in FileItem format

    return [...currentFolderUploads, ...baseItems]
  }, [
    itemsById,
    filesByParent,
    foldersByParent,
    currentFolderId,
    showUploading,
    activeSessionId,
    sessions,
    uploadFiles,
  ])

  // Build hierarchical items with upload integration
  const hierarchicalItems = useMemo(() => {
    // Get the buildHierarchicalView method from store
    const buildHierarchicalView = useFileSystemStore.getState().buildHierarchicalView

    // Start with base hierarchical structure (without uploads)
    const baseHierarchical = buildHierarchicalView(currentFolderId)

    // Add uploading files if enabled
    if (!showUploading || !activeSessionId) {
      return baseHierarchical
    }

    // Get ALL upload files for current folder (no status filtering)
    const session = sessions[activeSessionId]
    const currentFolderUploads =
      session?.fileIds
        .map((fileId) => uploadFiles[fileId])
        .filter(Boolean)
        .filter((file) => {
          // Check both parentId and metadata.targetFolderId for compatibility
          const uploadFolderId = file.parentId ?? file.metadata?.targetFolderId ?? null
          return uploadFolderId === currentFolderId
        }) || []

    // Use mergeFileItems for deduplication - prevents flickering
    return mergeFileItems(baseHierarchical, currentFolderUploads)
  }, [
    currentFolderId,
    showUploading,
    activeSessionId,
    sessions,
    uploadFiles,
    // Also depend on the items that would affect the hierarchical structure
    itemsById,
    filesByParent,
    foldersByParent,
  ])

  // Load more files in background - stable function to prevent infinite loops
  const flagsRef = useRef({ hasNextPage: false, isFetching: false })
  useEffect(() => {
    flagsRef.current = { hasNextPage: !!hasNextPage, isFetching }
  }, [hasNextPage, isFetching])

  const loadMoreFiles = useCallback(async () => {
    const { hasNextPage: next, isFetching: fetching } = flagsRef.current
    if (next && !fetching) {
      await fetchNextPage()
    }
  }, [fetchNextPage])

  // Navigation with search clearing - O(1) operations
  const navigateToFolder = useCallback(
    (folderId: string | null) => {
      setCurrentFolder(folderId) // This also clears search in the store
    },
    [setCurrentFolder]
  )

  // Query input (for optimistic updates)
  const queryInput = {
    filesLimit: 500,
    includeArchived: false,
  }

  // tRPC mutations (same interface, optimized internally)
  const createFolderMutation = api.folder.create.useMutation()
  const deleteMutation = api.file.delete.useMutation()
  const deleteFolderMutation = api.folder.delete.useMutation()
  const renameMutation = api.file.rename.useMutation()
  const renameFolderMutation = api.folder.rename.useMutation()
  const copyMutation = api.file.copy.useMutation()
  const copyFolderMutation = api.folder.copy.useMutation()

  // Enhanced moveItems mutation with optimistic updates
  const moveItemsMutation = api.file.moveItems.useMutation({
    // 1) Before the network call, patch the cache optimistically
    onMutate: async (vars: {
      items: Array<{ id: string; type: 'file' | 'folder' }>
      targetFolderId: string
    }) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await utils.file.getFileSystem.cancel(queryInput)

      // Snapshot current cache state for rollback
      const previousData = utils.file.getFileSystem.getInfiniteData(queryInput)

      // Get IDs of items being moved
      const movingIds = new Set(vars.items.map((i) => i.id))

      // Convert empty string back to null for UI consistency (server sends empty string for root)
      const optimisticParentId = vars.targetFolderId === '' ? null : vars.targetFolderId

      // Apply optimistic update to cache
      utils.file.getFileSystem.setInfiniteData(queryInput, (data) => {
        if (!data) return data

        // Clone pages and update items
        const pages = data.pages.map((page) => ({
          ...page,
          items: (page.items ?? []).map((item) => {
            if (movingIds.has(item.id)) {
              return {
                ...item,
                parentId: optimisticParentId,
                isOptimisticMove: true, // UI hint for styling
              }
            }
            return item
          }),
        }))

        return { ...data, pages }
      })

      // Set UI state for additional visual feedback
      setMovingIds(new Set([...movingIdsRef.current, ...movingIds]))

      return { previousData, movingIds }
    },

    // 2) If mutation fails, revert the cache
    onError: (error, vars, context) => {
      if (context?.previousData) {
        utils.file.getFileSystem.setInfiniteData(queryInput, context.previousData)
      }
      setMovingIds(new Set()) // Clear moving state

      // Enhanced error messaging
      let errorMessage = 'An error occurred'
      if (error instanceof Error) {
        if (error.message.includes('PERMISSION_DENIED')) {
          errorMessage = "You don't have permission to move these items"
        } else if (error.message.includes('NOT_FOUND')) {
          errorMessage = 'One or more items could not be found'
        } else {
          errorMessage = error.message
        }
      }

      toastError({
        title: 'Failed to move items',
        description: errorMessage,
      })
    },

    // 3) On success, show toast and clean up
    onSuccess: (result) => {
      if (result.failed > 0) {
        toastError({
          title: 'Partial move failure',
          description: `${result.moved} moved, ${result.failed} failed.`,
        })
      }
    },

    // 4) Always clean up and sync with server
    onSettled: async (result, error, vars) => {
      setMovingIds(new Set()) // Clear all moving state

      // Always invalidate to sync with server state - optimistic updates might not be perfect
      console.log('♻️ Invalidating cache after move operation')
      await utils.file.getFileSystem.invalidate(queryInput)
    },
  })

  // Mutation handlers with optimistic updates - now O(1) with Maps
  const createFolder = useCallback(
    async (name: string, parentId?: string | null) => {
      try {
        setIsLoading(true)
        const result = await createFolderMutation.mutateAsync({
          name,
          parentId: parentId ?? currentFolderId,
        })

        await refetchFileSystem() // Refresh data
        // toastSuccess({ title: 'Folder created', description: `${name} has been created` })
        return result
      } catch (error) {
        toastError({
          title: 'Failed to create folder',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [setIsLoading, createFolderMutation, currentFolderId, refetchFileSystem]
  )

  const deleteItems = useCallback(
    async (itemIds: string[]) => {
      try {
        setIsLoading(true)

        // O(1) lookup to separate files and folders using Maps
        const fileIds = itemIds.filter((id) => itemsById.get(id)?.type === 'file')
        const folderIds = itemIds.filter((id) => itemsById.get(id)?.type === 'folder')

        // Delete files and folders in parallel
        await Promise.all([
          ...fileIds.map((id) => deleteMutation.mutateAsync({ fileId: id })),
          ...folderIds.map((id) => deleteFolderMutation.mutateAsync({ folderId: id })),
        ])

        // O(1) optimistic update using Maps
        removeItems(itemIds)
        clearSelection()

        await refetchFileSystem()
        // toastSuccess({
        //   title: 'Items deleted',
        //   description: `${itemIds.length} item(s) have been deleted`,
        // })
      } catch (error) {
        toastError({
          title: 'Failed to delete items',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [
      setIsLoading,
      itemsById,
      deleteMutation,
      deleteFolderMutation,
      removeItems,
      clearSelection,
      refetchFileSystem,
    ]
  )

  const moveItems = useCallback(
    async (
      items: Array<{ id: string; type: 'file' | 'folder' }>,
      targetFolderId: string | null
    ) => {
      // Check network status before attempting move
      if (!navigator.onLine) {
        toastError({
          title: 'No internet connection',
          description: 'Please check your connection and try again.',
        })
        return
      }

      // Convert null to empty string for server compatibility
      const serverTargetFolderId = targetFolderId || ''

      // No manual loading states - React Query optimistic updates handle this
      await moveItemsMutation.mutateAsync({ items, targetFolderId: serverTargetFolderId })
      clearSelection()
      // No manual refetch - onSettled invalidation handles this
    },
    [moveItemsMutation, clearSelection]
  )

  const renameItem = useCallback(
    async (itemId: string, newName: string) => {
      try {
        setIsLoading(true)

        // O(1) lookup to determine item type
        const item = itemsById.get(itemId)
        if (!item) throw new Error('Item not found')

        if (item.type === 'folder') {
          await renameFolderMutation.mutateAsync({ folderId: itemId, newName: newName })
        } else {
          await renameMutation.mutateAsync({ fileId: itemId, newName: newName })
        }

        // O(1) optimistic update
        updateItem(itemId, { name: newName })
        await refetchFileSystem()
        // toastSuccess({ title: 'Item renamed', description: `Renamed to ${newName}` })
      } catch (error) {
        toastError({
          title: 'Failed to rename item',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [setIsLoading, itemsById, renameFolderMutation, renameMutation, updateItem, refetchFileSystem]
  )

  const copyItems = useCallback(
    async (itemIds: string[], targetFolderId: string) => {
      try {
        setIsLoading(true)

        // O(1) lookup to separate files and folders using Maps
        const fileIds = itemIds.filter((id) => itemsById.get(id)?.type === 'file')
        const folderIds = itemIds.filter((id) => itemsById.get(id)?.type === 'folder')

        // Copy files and folders in parallel
        await Promise.all([
          ...fileIds.map((id) => copyMutation.mutateAsync({ fileId: id, targetFolderId })),
          ...folderIds.map((id) =>
            copyFolderMutation.mutateAsync({ sourceFolderId: id, targetParentId: targetFolderId })
          ),
        ])

        await refetchFileSystem()
        clearSelection()
        // toastSuccess({
        //   title: 'Items copied',
        //   description: `${itemIds.length} item(s) have been copied`,
        // })
      } catch (error) {
        toastError({
          title: 'Failed to copy items',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [setIsLoading, itemsById, copyMutation, copyFolderMutation, refetchFileSystem, clearSelection]
  )

  // Handle file drops for upload
  const handleFilesDropped = useCallback(
    async (files: File[]) => {
      try {
        // Add files to upload system
        const fileIds = await upload.addFiles(files)

        // CRITICAL FIX: Update each added file with the current folder as parentId
        // This ensures hierarchicalItems can filter correctly even when navigating between folders
        if (fileIds.length > 0) {
          useUploadStore.setState((state) => {
            for (const fileId of fileIds) {
              const file = state.files[fileId]
              if (file) {
                // Update file with parentId for proper folder filtering
                file.parentId = currentFolderId
                // Also set in metadata for backwards compatibility
                if (!file.metadata) {
                  file.metadata = {}
                }
                file.metadata.targetFolderId = currentFolderId
              }
            }
          })
        }

        // Start upload immediately
        await upload.startUpload()
      } catch (error) {
        toastError({
          title: 'Upload failed',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [upload, currentFolderId]
  )

  return {
    // Data (all O(1) access with computed properties)
    items,
    hierarchicalItems, // Hierarchical view with subRows for TanStack Table
    selectedItems, // O(1) computed property
    currentFolderId,
    breadcrumbs,
    folderTree, // O(1) computed property
    isLoading: isLoading || isFetching,

    // Actions (all O(1) optimized)
    navigateToFolder,
    loadMoreFiles,
    refetchFileSystem,

    // Capabilities - use React Query's source of truth
    hasMoreFiles: !!hasNextPage,
    totalFiles: allFileIds.length, // O(1) computed property
    totalFolders: allFolderIds.length, // O(1) computed property

    // Error state
    hasErrors: !!fileSystemError,

    // Mutation methods (now O(1) optimized)
    isCreatingFolder: createFolderMutation.isPending,
    createFolder,
    deleteItems,
    moveItems,
    renameItem,
    copyItems,
    handleFilesDropped,

    // Selection methods (Set-based O(1) operations)
    selectItems,
    unselectItems,
    toggleItemSelection,
    clearSelection,
    setSelectedItems,

    // View controls (unchanged interface)
    viewMode,
    sortBy,
    sortOrder,
    filterSettings,
    setViewMode,
    setSorting,
    setFilterSettings,

    // Upload integration (unchanged interface)
    showUploading,
    addUploadingItems,
    updateUploadProgress,
    removeCompletedUploads,

    // Tree operations (O(1) and O(log n) with Maps)
    getItemPath,
    getItemChildren,
    getItemDescendants,

    // Optimistic move helpers
    isMoving: useCallback((id: string) => {
      const isCurrentlyMoving = movingIdsRef.current.has(id)
      if (isCurrentlyMoving) {
        console.log('🎯 isMoving check for', id, ':', isCurrentlyMoving)
      }
      return isCurrentlyMoving
    }, []),
  }
}
