// apps/web/src/components/files/files-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

/**
 * Unified interface that can represent both server and uploading files
 * Now includes all server-specific and folder-specific fields
 */
export interface FileItem {
  // Core fields (server + upload compatible)
  id: string // Server ID or temp ID during upload
  name: string
  type: 'file' | 'folder'
  size?: bigint | null // Always bigint for consistency
  displaySize: number // Normalized to number for consistent display
  mimeType?: string | null // Unified field name
  ext?: string | null // File extension
  createdAt: Date
  updatedAt: Date
  path: string
  parentId?: string | null // UNIFIED: use parentId everywhere (not folderId)
  isArchived?: boolean

  // Upload/processing state (only for uploads)
  status?:
    | 'pending'
    | 'uploading'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'deleting'
  progress?: number // 0-100 progress percentage
  error?: string // Error message if failed
  isUploading?: boolean // Flag to identify upload files
  source?: 'upload' | 'filesystem' // Source of the file (upload or filesystem)
  tempId?: string // For upload tracking before server ID
  serverFileId?: string // Server ID after upload completes
  url?: string // File URL if available
  uploadFileId?: string // Upload store file ID for real-time subscription

  // Server-specific fields (only for server files)
  organizationId?: string
  createdById?: string
  currentVersionId?: string | null
  deletedAt?: Date | null

  // Folder-specific fields (only for folders)
  fileCount?: number // Number of files in folder
  subfolderCount?: number // Number of subfolders
  depth?: number // Folder depth in hierarchy

  // Computed hierarchy (server provides, store uses directly)
  hierarchy?: {
    folderName: string
    folderPath: string
    fullPath: string
    breadcrumbs: BreadcrumbItem[]
  }

  // UI state properties
  isSelected?: boolean
  isExpanded?: boolean // for folders in tree view

  // Optimistic state (UI-only hint)
  isOptimisticMove?: boolean // Item is being moved optimistically

  // TanStack Table row expanding support
  subRows?: FileItem[] // Children for hierarchical display (TanStack Table automatically provides depth and expansion state)
}

/**
 * Type guard to check if item is uploading
 */
export function isUploadingItem(
  item: FileItem
): item is FileItem & Required<Pick<FileItem, 'status'>> {
  return item.isUploading === true
}

/**
 * Breadcrumb navigation item
 */
export interface BreadcrumbItem {
  id: string | null
  name: string
  path: string
}

/**
 * File filtering settings
 */
export interface FileFilterSettings {
  fileTypes: string[] // ['images', 'documents', 'videos', etc.]
  sizeRange: {
    min?: number
    max?: number
  }
  showHidden: boolean
  showUploading: boolean // Toggle upload visibility
  sortBy: 'name' | 'size' | 'type' | 'created' | 'modified'
  sortOrder: 'asc' | 'desc'
}

/**
 * Folder tree node for sidebar navigation
 */
export interface FolderTreeNode {
  id: string
  name: string
  path: string
  depth: number
  parentId: string | null
  children: FolderTreeNode[]
  fileCount: number
  totalSize: bigint
  isExpanded?: boolean
  isSelected?: boolean
}

/**
 * Maps-first filesystem store for O(1) performance
 */
export interface FileSystemStore {
  // Primary data storage - Maps for O(1) access
  itemsById: Map<string, FileItem> // All items by ID
  filesByParent: Map<string | null, string[]> // File IDs by parent folder
  foldersByParent: Map<string | null, string[]> // Folder IDs by parent folder
  folderTreeById: Map<string, FolderTreeNode> // Folder tree nodes by ID

  // Search indexes for O(1) search
  searchTermToItemIds: Map<string, Set<string>> // Search term -> item IDs
  itemIdToSearchTerms: Map<string, string[]> // Item ID -> search terms

  // Navigation state
  currentFolderId: string | null
  breadcrumbs: BreadcrumbItem[]

  // Selection (optimized with Set)
  selectedItemIds: Set<string> // Selected item IDs only

  // View state
  viewMode: 'grid' | 'list'
  sortBy: 'name' | 'size' | 'type' | 'created' | 'modified'
  sortOrder: 'asc' | 'desc'
  filterSettings: FileFilterSettings

  // Loading & pagination
  isLoading: boolean
  filesNextCursor: string | null
  hasMoreFiles: boolean
  lastSync: Date | null

  // Search state
  searchQuery: string

  // Upload integration
  showUploading: boolean

  // Computed properties (getters)
  readonly allFileIds: string[] // Computed from itemsById
  readonly allFolderIds: string[] // Computed from itemsById
  readonly allItems: FileItem[] // Computed from itemsById
  readonly selectedItems: FileItem[] // Computed from selectedItemIds + itemsById
  readonly currentFolderItems: FileItem[] // Files + folders in current directory
  readonly currentFolderFiles: FileItem[] // Files only in current directory
  readonly currentFolderSubfolders: FileItem[] // Folders only in current directory
  readonly searchResults: FileItem[] // Computed from search indexes
  readonly folderTree: FolderTreeNode[] // Computed from folderTreeById
  readonly hierarchicalItems: FileItem[] // Hierarchical view with subRows for TanStack Table

  // Core actions (optimized implementations)
  setFileSystemData: (items: FileItem[]) => void
  setCurrentFolder: (folderId: string | null) => void
  setSearchQuery: (query: string) => void

  // Selection actions (Set-based)
  selectItems: (itemIds: string[]) => void
  unselectItems: (itemIds: string[]) => void
  toggleItemSelection: (itemId: string) => void
  clearSelection: () => void
  setSelectedItems: (itemIds: string[]) => void

  // Item management
  updateItem: (itemId: string, updates: Partial<FileItem>) => void
  removeItems: (itemIds: string[]) => void
  addItems: (items: FileItem[]) => void

  // Upload-specific actions
  addUploadingItems: (uploadFiles: FileItem[]) => void
  updateUploadProgress: (tempId: string, progress: number, status: FileItem['status']) => void
  removeCompletedUploads: () => void

  // View controls
  setViewMode: (mode: 'grid' | 'list') => void
  setSorting: (
    sortBy: 'name' | 'size' | 'type' | 'created' | 'modified',
    sortOrder: 'asc' | 'desc'
  ) => void
  setFilterSettings: (settings: FileFilterSettings) => void

  // Loading state
  setIsLoading: (isLoading: boolean) => void
  setBreadcrumbs: (breadcrumbs: BreadcrumbItem[]) => void

  // Tree operations (O(1) or O(log n))
  getItemPath: (itemId: string) => FileItem[] // Get full path to item
  getItemChildren: (itemId: string) => FileItem[] // Get direct children
  getItemDescendants: (itemId: string) => FileItem[] // Get all descendants
  buildHierarchicalView: (parentId: string | null) => FileItem[] // Build hierarchical view with subRows

  // Utility actions
  reset: () => void
}

/**
 * Zustand store implementation with Maps-first approach
 */
export const useFileSystemStore = create<FileSystemStore>()(
  subscribeWithSelector((set, get) => ({
    // Primary storage - Maps for O(1) access
    itemsById: new Map(),
    filesByParent: new Map(),
    foldersByParent: new Map(),
    folderTreeById: new Map(),
    searchTermToItemIds: new Map(),
    itemIdToSearchTerms: new Map(),

    // State
    currentFolderId: null,
    breadcrumbs: [{ id: null, name: 'Files', path: '/' }],
    selectedItemIds: new Set(),
    viewMode: 'list',
    sortBy: 'name',
    sortOrder: 'asc',
    searchQuery: '',
    isLoading: false,
    filesNextCursor: null,
    hasMoreFiles: false,
    lastSync: null,
    showUploading: true,
    filterSettings: {
      fileTypes: [],
      sizeRange: {},
      showHidden: false,
      showUploading: true,
      sortBy: 'name',
      sortOrder: 'asc',
    },

    // Computed properties (getters)
    get allFileIds() {
      return Array.from(this.itemsById.keys()).filter(
        (id) => this.itemsById.get(id)?.type === 'file'
      )
    },

    get allFolderIds() {
      return Array.from(this.itemsById.keys()).filter(
        (id) => this.itemsById.get(id)?.type === 'folder'
      )
    },

    get allItems() {
      return Array.from(this.itemsById.values())
    },

    get selectedItems() {
      return Array.from(this.selectedItemIds)
        .map((id) => this.itemsById.get(id))
        .filter(Boolean) as FileItem[]
    },

    get currentFolderItems() {
      const fileIds = this.filesByParent.get(this.currentFolderId) || []
      const folderIds = this.foldersByParent.get(this.currentFolderId) || []

      return [...fileIds, ...folderIds]
        .map((id) => this.itemsById.get(id))
        .filter(Boolean) as FileItem[]
    },

    get currentFolderFiles() {
      const fileIds = this.filesByParent.get(this.currentFolderId) || []
      return fileIds.map((id) => this.itemsById.get(id)).filter(Boolean) as FileItem[]
    },

    get currentFolderSubfolders() {
      const folderIds = this.foldersByParent.get(this.currentFolderId) || []
      return folderIds.map((id) => this.itemsById.get(id)).filter(Boolean) as FileItem[]
    },

    get searchResults() {
      if (!this.searchQuery.trim()) return []

      const query = this.searchQuery.toLowerCase()
      const matchingItemIds = new Set<string>()

      // Use search indexes for O(1) lookups
      for (const [term, itemIds] of this.searchTermToItemIds) {
        if (term.includes(query)) {
          itemIds.forEach((id) => matchingItemIds.add(id))
        }
      }

      // Also do direct name matching for partial queries
      for (const [itemId, terms] of this.itemIdToSearchTerms) {
        if (terms.some((term) => term.includes(query))) {
          matchingItemIds.add(itemId)
        }
      }

      return Array.from(matchingItemIds)
        .map((id) => this.itemsById.get(id))
        .filter(Boolean) as FileItem[]
    },

    get folderTree() {
      return Array.from(this.folderTreeById.values())
    },

    get hierarchicalItems() {
      // Transform current folder items into tree structure with subRows
      // This creates a hierarchical view of the current folder for TanStack Table
      return this.buildHierarchicalView(this.currentFolderId)
    },

    // Core actions - simplified with direct FileItem[] processing
    setFileSystemData: (items) => {
      const itemsById = new Map<string, FileItem>()
      const filesByParent = new Map<string | null, string[]>()
      const foldersByParent = new Map<string | null, string[]>()
      const searchTermToItemIds = new Map<string, Set<string>>()
      const itemIdToSearchTerms = new Map<string, string[]>()
      const folderTreeById = new Map<string, FolderTreeNode>()

      // Process all items (files and folders together)
      items.forEach((item) => {
        // Store item directly - no transformation needed
        itemsById.set(item.id, item)

        // Index by parent for O(1) folder contents
        const parentId = item.parentId
        if (item.type === 'file') {
          if (!filesByParent.has(parentId)) {
            filesByParent.set(parentId, [])
          }
          filesByParent.get(parentId)!.push(item.id)
        } else {
          if (!foldersByParent.has(parentId)) {
            foldersByParent.set(parentId, [])
          }
          foldersByParent.get(parentId)!.push(item.id)
        }

        // Build search index for O(1) search
        const searchTerms: string[] = [
          item.name.toLowerCase(),
          item.ext?.toLowerCase(),
          item.mimeType?.toLowerCase(),
        ].filter(Boolean) as string[]

        // Add hierarchy terms if available
        if (item.hierarchy) {
          searchTerms.push(
            ...item.hierarchy.fullPath
              .split('/')
              .filter(Boolean)
              .map((s) => s.toLowerCase()),
            item.hierarchy.folderName.toLowerCase()
          )
        } else {
          // Fallback for items without hierarchy
          searchTerms.push(
            ...item.path
              .split('/')
              .filter(Boolean)
              .map((s) => s.toLowerCase())
          )
        }

        itemIdToSearchTerms.set(item.id, searchTerms)
        searchTerms.forEach((term) => {
          if (!searchTermToItemIds.has(term)) {
            searchTermToItemIds.set(term, new Set())
          }
          searchTermToItemIds.get(term)!.add(item.id)
        })

        // Build folder tree for folders
        if (item.type === 'folder') {
          const node: FolderTreeNode = {
            id: item.id,
            name: item.name,
            path: item.path,
            depth: item.depth || 0,
            parentId: item.parentId,
            children: [], // Will be built in a second pass
            fileCount: item.fileCount || 0,
            totalSize: BigInt(0), // Could be calculated from files
          }
          folderTreeById.set(item.id, node)
        }
      })

      // Build folder tree relationships
      const rootFolders: FolderTreeNode[] = []
      for (const [folderId, node] of folderTreeById) {
        if (!node.parentId) {
          rootFolders.push(node)
        } else {
          const parentNode = folderTreeById.get(node.parentId)
          if (parentNode) {
            parentNode.children.push(node)
          }
        }
      }

      set({
        itemsById,
        filesByParent,
        foldersByParent,
        searchTermToItemIds,
        itemIdToSearchTerms,
        folderTreeById,
      })
    },

    setCurrentFolder: (folderId) => {
      set({
        currentFolderId: folderId,
        searchQuery: '', // Clear search when navigating
      })
    },

    setSearchQuery: (query) => {
      set({ searchQuery: query })
    },

    // Selection actions - Set-based for O(1) operations
    selectItems: (itemIds) => {
      set((state) => ({
        selectedItemIds: new Set([...state.selectedItemIds, ...itemIds]),
      }))
    },

    unselectItems: (itemIds) => {
      set((state) => {
        const newSelected = new Set(state.selectedItemIds)
        itemIds.forEach((id) => newSelected.delete(id))
        return { selectedItemIds: newSelected }
      })
    },

    toggleItemSelection: (itemId) => {
      set((state) => {
        const newSelected = new Set(state.selectedItemIds)
        if (newSelected.has(itemId)) {
          newSelected.delete(itemId)
        } else {
          newSelected.add(itemId)
        }
        return { selectedItemIds: newSelected }
      })
    },

    clearSelection: () => {
      set({ selectedItemIds: new Set() })
    },

    setSelectedItems: (itemIds) => {
      set({ selectedItemIds: new Set(itemIds) })
    },

    // Item management - Map-based
    updateItem: (itemId, updates) => {
      set((state) => {
        const item = state.itemsById.get(itemId)
        if (!item) return state

        const updatedItem = { ...item, ...updates }
        const newItemsById = new Map(state.itemsById)
        newItemsById.set(itemId, updatedItem)

        return { itemsById: newItemsById }
      })
    },

    removeItems: (itemIds) => {
      set((state) => {
        const newItemsById = new Map(state.itemsById)
        const newFilesByParent = new Map(state.filesByParent)
        const newFoldersByParent = new Map(state.foldersByParent)
        const newSelectedItemIds = new Set(state.selectedItemIds)
        const newSearchTermToItemIds = new Map(state.searchTermToItemIds)
        const newItemIdToSearchTerms = new Map(state.itemIdToSearchTerms)

        itemIds.forEach((itemId) => {
          const item = newItemsById.get(itemId)
          if (!item) return

          // Remove from main storage
          newItemsById.delete(itemId)

          // Remove from parent indexes
          const parentId = item.parentId
          if (item.type === 'file') {
            const siblings = newFilesByParent.get(parentId) || []
            newFilesByParent.set(
              parentId,
              siblings.filter((id) => id !== itemId)
            )
          } else {
            const siblings = newFoldersByParent.get(parentId) || []
            newFoldersByParent.set(
              parentId,
              siblings.filter((id) => id !== itemId)
            )
          }

          // Remove from selection
          newSelectedItemIds.delete(itemId)

          // Remove from search indexes
          const searchTerms = newItemIdToSearchTerms.get(itemId) || []
          searchTerms.forEach((term) => {
            const itemIds = newSearchTermToItemIds.get(term)
            if (itemIds) {
              itemIds.delete(itemId)
              if (itemIds.size === 0) {
                newSearchTermToItemIds.delete(term)
              }
            }
          })
          newItemIdToSearchTerms.delete(itemId)
        })

        return {
          itemsById: newItemsById,
          filesByParent: newFilesByParent,
          foldersByParent: newFoldersByParent,
          selectedItemIds: newSelectedItemIds,
          searchTermToItemIds: newSearchTermToItemIds,
          itemIdToSearchTerms: newItemIdToSearchTerms,
        }
      })
    },

    addItems: (items) => {
      set((state) => {
        const newItemsById = new Map(state.itemsById)
        const newFilesByParent = new Map(state.filesByParent)
        const newFoldersByParent = new Map(state.foldersByParent)

        items.forEach((item) => {
          newItemsById.set(item.id, item)

          const parentId = item.parentId
          if (item.type === 'file') {
            if (!newFilesByParent.has(parentId)) {
              newFilesByParent.set(parentId, [])
            }
            newFilesByParent.get(parentId)!.push(item.id)
          } else {
            if (!newFoldersByParent.has(parentId)) {
              newFoldersByParent.set(parentId, [])
            }
            newFoldersByParent.get(parentId)!.push(item.id)
          }
        })

        return {
          itemsById: newItemsById,
          filesByParent: newFilesByParent,
          foldersByParent: newFoldersByParent,
        }
      })
    },

    // Upload-specific actions
    addUploadingItems: (uploadFiles) => {
      get().addItems(uploadFiles)
    },

    updateUploadProgress: (tempId, progress, status) => {
      set((state) => {
        // Find item by tempId
        const item = Array.from(state.itemsById.values()).find((item) => item.tempId === tempId)
        if (item) {
          get().updateItem(item.id, { progress, status })
        }
        return state
      })
    },

    removeCompletedUploads: () => {
      set((state) => {
        const completedUploadIds = Array.from(state.itemsById.values())
          .filter((item) => item.isUploading && ['completed', 'cancelled'].includes(item.status!))
          .map((item) => item.id)

        if (completedUploadIds.length > 0) {
          get().removeItems(completedUploadIds)
        }

        return state
      })
    },

    // View controls
    setViewMode: (mode) => set({ viewMode: mode }),
    setSorting: (sortBy, sortOrder) => set({ sortBy, sortOrder }),
    setFilterSettings: (settings) => set({ filterSettings: settings }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),

    // Tree operations - O(1) or O(log n) with Maps
    getItemPath: (itemId) => {
      const item = get().itemsById.get(itemId)
      if (!item) return []

      const path: FileItem[] = [item]
      let currentId = item.parentId

      while (currentId) {
        const parent = get().itemsById.get(currentId)
        if (!parent) break
        path.unshift(parent)
        currentId = parent.parentId
      }

      return path
    },

    getItemChildren: (itemId) => {
      const fileIds = get().filesByParent.get(itemId) || []
      const folderIds = get().foldersByParent.get(itemId) || []

      return [...fileIds, ...folderIds]
        .map((id) => get().itemsById.get(id))
        .filter(Boolean) as FileItem[]
    },

    getItemDescendants: (itemId) => {
      const descendants: FileItem[] = []
      const toProcess = [itemId]

      while (toProcess.length > 0) {
        const currentId = toProcess.shift()!
        const children = get().getItemChildren(currentId)

        children.forEach((child) => {
          descendants.push(child)
          if (child.type === 'folder') {
            toProcess.push(child.id)
          }
        })
      }

      return descendants
    },

    buildHierarchicalView: (parentId) => {
      const children = get().getItemChildren(parentId) // Reuse existing O(1) method
      return children.map((item) => ({
        ...item,
        subRows: item.type === 'folder' ? get().buildHierarchicalView(item.id) : undefined,
      }))
    },

    // Utility
    reset: () =>
      set({
        itemsById: new Map(),
        filesByParent: new Map(),
        foldersByParent: new Map(),
        folderTreeById: new Map(),
        searchTermToItemIds: new Map(),
        itemIdToSearchTerms: new Map(),
        currentFolderId: null,
        selectedItemIds: new Set(),
        searchQuery: '',
        isLoading: false,
        filesNextCursor: null,
        hasMoreFiles: false,
        lastSync: null,
        breadcrumbs: [{ id: null, name: 'Files', path: '/' }],
      }),
  }))
)
