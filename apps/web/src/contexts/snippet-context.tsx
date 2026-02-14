'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useQueryState } from 'nuqs'
import type React from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import type {
  CreateFolderInput,
  CreateSnippetInput,
  PanelState,
  SharingInput,
  Snippet,
  SnippetContextState,
  SnippetFolder,
  UpdateFolderInput,
  UpdateSnippetInput,
} from './snippet-types'
import {
  buildBreadcrumbTrail,
  calculatePanelSizes,
  createOptimisticFolder,
  createOptimisticSnippet,
  getCurrentFolderName,
  isTempFolder,
  isTempSnippet,
  validatePanelSize,
} from './snippet-utils'

/**
 * Context value interface defining all available operations and state
 */
interface SnippetContextValue extends SnippetContextState {
  // Snippet Operations
  createSnippet: (data: CreateSnippetInput) => Promise<void>
  updateSnippet: (id: string, data: UpdateSnippetInput) => Promise<void>
  deleteSnippet: (id: string) => Promise<void>
  copySnippet: (snippet: Snippet) => Promise<void>
  incrementSnippetUsage: (id: string) => Promise<void>

  // Folder Operations
  createFolder: (data: CreateFolderInput) => Promise<void>
  updateFolder: (id: string, data: UpdateFolderInput) => Promise<void>
  deleteFolder: (id: string, moveSnippetsTo?: string) => Promise<void>

  // Sharing Operations
  shareSnippet: (snippetId: string, sharing: SharingInput) => Promise<void>

  // State Management
  setSelectedFolderId: (folderId: string | null) => void
  setSearchTerm: (term: string) => void

  // Dialog Management
  setCreateDialogOpen: (open: boolean) => void
  setEditDialogOpen: (open: boolean) => void
  setEditingSnippet: (snippet: Snippet | null) => void
  openCreateDialog: (snippet?: Partial<Snippet>) => void
  openEditDialog: (snippet: Snippet) => void
  closeDialogs: () => void

  // Panel Management
  onFolderPanelResize: (size: number) => void
  onFolderPanelCollapse: () => void
  onFolderPanelExpand: () => void
  toggleFolderPanel: () => void

  // Computed Values
  breadcrumbs: Array<{ title: string; href?: string }>
  currentFolderName: string | null
  folders: SnippetFolder[]
}

const SnippetContext = createContext<SnippetContextValue | null>(null)

/**
 * Default panel state configuration
 */
const DEFAULT_PANEL_STATE: PanelState = { isCollapsed: true, size: 0, defaultSize: 25, minSize: 20 }

/**
 * Snippet Context Provider
 * Manages all snippet and folder operations with optimistic updates
 */
export function SnippetProvider({ children }: { children: React.ReactNode }) {
  // URL state management
  const [selectedFolderId, setSelectedFolderId] = useQueryState('folder')
  const [searchTerm, setSearchTerm] = useQueryState('search')

  // Dialog state management
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null)

  // Panel state management
  const [folderPanelState, setFolderPanelState] = useState<PanelState>(DEFAULT_PANEL_STATE)

  // tRPC utils for cache management
  const utils = api.useUtils()

  // Fetch folders data
  const { data: folderData } = api.snippet.getFolders.useQuery()
  const folders = folderData?.folders || []

  // Snippet mutations
  const createSnippetMutation = api.snippet.create.useMutation()
  const updateSnippetMutation = api.snippet.update.useMutation()
  const deleteSnippetMutation = api.snippet.delete.useMutation()
  const incrementUsageMutation = api.snippet.incrementUsage.useMutation()

  // Folder mutations
  const createFolderMutation = api.snippet.createFolder.useMutation()
  const updateFolderMutation = api.snippet.updateFolder.useMutation()
  const deleteFolderMutation = api.snippet.deleteFolder.useMutation()

  // Sharing mutation
  const shareSnippetMutation = api.snippet.share.useMutation()

  // Loading states derived from mutations
  const isCreatingSnippet = createSnippetMutation.isPending
  const isUpdatingSnippet = updateSnippetMutation.isPending
  const isDeletingSnippet = deleteSnippetMutation.isPending
  const isCreatingFolder = createFolderMutation.isPending
  const isUpdatingFolder = updateFolderMutation.isPending
  const isDeletingFolder = deleteFolderMutation.isPending

  // Snippet Operations
  const createSnippet = useCallback(
    async (data: CreateSnippetInput) => {
      try {
        await createSnippetMutation.mutateAsync({
          ...data,
          folderId: data.folderId || selectedFolderId || undefined,
        })

        // Invalidate queries to refetch fresh data
        utils.snippet.all.invalidate()
        utils.snippet.getFolders.invalidate()

        toastSuccess({
          title: 'Snippet created',
          description: 'Your snippet has been created successfully',
        })
      } catch (error: any) {
        toastError({
          title: 'Error creating snippet',
          description: error.message || 'Failed to create snippet',
        })
        throw error
      }
    },
    [selectedFolderId, utils, createSnippetMutation]
  )

  const updateSnippet = useCallback(
    async (id: string, data: UpdateSnippetInput) => {
      if (isTempSnippet(id)) {
        throw new Error('Cannot update temporary snippet')
      }

      try {
        await updateSnippetMutation.mutateAsync({ id, ...data })

        // Invalidate related queries to refetch fresh data
        utils.snippet.all.invalidate()
        utils.snippet.getFolders.invalidate()
        utils.snippet.byId.invalidate({ id })

        toastSuccess({
          title: 'Snippet updated',
          description: 'Your snippet has been updated successfully',
        })
      } catch (error: any) {
        toastError({
          title: 'Error updating snippet',
          description: error.message || 'Failed to update snippet',
        })
        throw error
      }
    },
    [utils, updateSnippetMutation]
  )

  const deleteSnippet = useCallback(
    async (id: string) => {
      if (isTempSnippet(id)) {
        throw new Error('Cannot delete temporary snippet')
      }

      try {
        await deleteSnippetMutation.mutateAsync({ id })

        // Invalidate the snippet and folder queries to refetch fresh data
        utils.snippet.all.invalidate()
        utils.snippet.getFolders.invalidate()

        toastSuccess({
          title: 'Snippet deleted',
          description: 'The snippet has been deleted successfully',
        })
      } catch (error: any) {
        toastError({
          title: 'Error deleting snippet',
          description: error.message || 'Failed to delete snippet',
        })
        throw error
      }
    },
    [utils, deleteSnippetMutation]
  )

  const copySnippet = useCallback(
    async (snippet: Snippet) => {
      const copyData: CreateSnippetInput = {
        title: `Copy of ${snippet.title}`,
        content: snippet.content,
        contentHtml: snippet.contentHtml,
        description: snippet.description,
        folderId: snippet.folderId,
        sharingType: snippet.sharingType,
        isFavorite: snippet.isFavorite,
      }

      await createSnippet(copyData)
    },
    [createSnippet]
  )

  const incrementSnippetUsage = useCallback(
    async (id: string) => {
      if (isTempSnippet(id)) return

      try {
        await incrementUsageMutation.mutateAsync({ id })
        // Silently increment - no toast needed for usage tracking
      } catch (error) {
        // Silent failure for usage tracking
        console.warn('Failed to increment snippet usage:', error)
      }
    },
    [incrementUsageMutation]
  )

  // Folder Operations
  const createFolder = useCallback(
    async (data: CreateFolderInput) => {
      try {
        await createFolderMutation.mutateAsync({ ...data, parentId: data.parentId || undefined })

        // Invalidate queries to refetch fresh data
        utils.snippet.getFolders.invalidate()

        toastSuccess({
          title: 'Folder created',
          description: 'The folder has been created successfully',
        })
      } catch (error: any) {
        toastError({
          title: 'Error creating folder',
          description: error.message || 'Failed to create folder',
        })
        throw error
      }
    },
    [utils, createFolderMutation]
  )

  const updateFolder = useCallback(
    async (id: string, data: UpdateFolderInput) => {
      if (isTempFolder(id)) {
        throw new Error('Cannot update temporary folder')
      }

      try {
        await updateFolderMutation.mutateAsync({ id, ...data })

        // Invalidate queries to refetch fresh data
        utils.snippet.getFolders.invalidate()

        toastSuccess({
          title: 'Folder updated',
          description: 'The folder has been updated successfully',
        })
      } catch (error: any) {
        toastError({
          title: 'Error updating folder',
          description: error.message || 'Failed to update folder',
        })
        throw error
      }
    },
    [utils, updateFolderMutation]
  )

  const deleteFolder = useCallback(
    async (id: string, moveSnippetsTo?: string) => {
      if (isTempFolder(id)) {
        throw new Error('Cannot delete temporary folder')
      }

      try {
        await deleteFolderMutation.mutateAsync({ id, moveSnippetsTo })

        // If we're currently viewing the deleted folder, navigate to root
        if (selectedFolderId === id) {
          setSelectedFolderId(null)
        }

        // Invalidate queries to refetch fresh data
        utils.snippet.getFolders.invalidate()
        utils.snippet.all.invalidate()

        toastSuccess({
          title: 'Folder deleted',
          description: 'The folder has been deleted successfully',
        })
      } catch (error: any) {
        toastError({
          title: 'Error deleting folder',
          description: error.message || 'Failed to delete folder',
        })
        throw error
      }
    },
    [utils, deleteFolderMutation, selectedFolderId, setSelectedFolderId]
  )

  // Sharing Operations
  const shareSnippet = useCallback(
    async (snippetId: string, sharing: SharingInput) => {
      if (isTempSnippet(snippetId)) {
        throw new Error('Cannot share temporary snippet')
      }

      try {
        await shareSnippetMutation.mutateAsync({ snippetId, ...sharing })

        utils.snippet.all.invalidate()
        utils.snippet.byId.invalidate({ id: snippetId })

        toastSuccess({
          title: 'Sharing updated',
          description: 'Snippet sharing settings have been updated',
        })
      } catch (error: any) {
        toastError({
          title: 'Error updating sharing',
          description: error.message || 'Failed to update sharing settings',
        })
        throw error
      }
    },
    [utils, shareSnippetMutation]
  )

  // Dialog Management
  const openCreateDialog = useCallback((snippet?: Partial<Snippet>) => {
    setEditingSnippet(snippet ? ({ ...snippet, id: undefined } as any) : null)
    setCreateDialogOpen(true)
    setEditDialogOpen(false)
  }, [])

  const openEditDialog = useCallback((snippet: Snippet) => {
    setEditingSnippet(snippet)
    setEditDialogOpen(true)
    setCreateDialogOpen(false)
  }, [])

  const closeDialogs = useCallback(() => {
    setCreateDialogOpen(false)
    setEditDialogOpen(false)
    setEditingSnippet(null)
  }, [])

  // Panel Management
  const onFolderPanelResize = useCallback((size: number) => {
    setFolderPanelState((prev) => ({ ...prev, size: size, isCollapsed: size === 0 }))
  }, [])

  const onFolderPanelCollapse = useCallback(() => {
    console.log('Folder panel collapsed')
    setFolderPanelState((prev) => ({ ...prev, isCollapsed: true, size: 0 }))
  }, [])

  const onFolderPanelExpand = useCallback(() => {
    console.log('Folder panel expanded')
    setFolderPanelState((prev) => ({ ...prev, isCollapsed: false, size: prev.defaultSize }))
  }, [])

  const toggleFolderPanel = useCallback(() => {
    setFolderPanelState((prev) => {
      if (prev.isCollapsed) {
        const { size } = calculatePanelSizes(false, prev.size, prev.defaultSize, prev.minSize)
        return { ...prev, isCollapsed: false, size }
      } else {
        return { ...prev, isCollapsed: true, size: 0 }
      }
    })
  }, [])

  // Computed values
  const breadcrumbs = useMemo(
    () => buildBreadcrumbTrail(selectedFolderId, folders),
    [selectedFolderId, folders]
  )

  const currentFolderName = useMemo(
    () => getCurrentFolderName(selectedFolderId, folders),
    [selectedFolderId, folders]
  )

  // Handle search term normalization
  const handleSetSearchTerm = useCallback(
    (term: string) => {
      setSearchTerm(term || null)
    },
    [setSearchTerm]
  )

  // Handle folder selection normalization
  const handleSetSelectedFolderId = useCallback(
    (folderId: string | null) => {
      setSelectedFolderId(folderId || null)
    },
    [setSelectedFolderId]
  )

  const contextValue: SnippetContextValue = {
    // State
    selectedFolderId,
    searchTerm: searchTerm || '',
    createDialogOpen,
    editDialogOpen,
    editingSnippet,
    folderPanelState,
    isCreatingSnippet,
    isUpdatingSnippet,
    isDeletingSnippet,
    isCreatingFolder,
    isUpdatingFolder,
    isDeletingFolder,

    // Snippet Operations
    createSnippet,
    updateSnippet,
    deleteSnippet,
    copySnippet,
    incrementSnippetUsage,

    // Folder Operations
    createFolder,
    updateFolder,
    deleteFolder,

    // Sharing Operations
    shareSnippet,

    // State Management
    setSelectedFolderId: handleSetSelectedFolderId,
    setSearchTerm: handleSetSearchTerm,

    // Dialog Management
    setCreateDialogOpen,
    setEditDialogOpen,
    setEditingSnippet,
    openCreateDialog,
    openEditDialog,
    closeDialogs,

    // Panel Management
    onFolderPanelResize,
    onFolderPanelCollapse,
    onFolderPanelExpand,
    toggleFolderPanel,

    // Computed Values
    breadcrumbs,
    currentFolderName,
    folders,
  }

  return <SnippetContext.Provider value={contextValue}>{children}</SnippetContext.Provider>
}

/**
 * Hook to consume the snippet context
 * Throws an error if used outside of SnippetProvider
 */
export function useSnippetContext(): SnippetContextValue {
  const context = useContext(SnippetContext)
  if (!context) {
    throw new Error('useSnippetContext must be used within a SnippetProvider')
  }
  return context
}
