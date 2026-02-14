import type { SnippetSharingType } from '@auxx/database/enums'
/**
 * Input types for snippet operations
 */
export interface CreateSnippetInput {
  title: string
  content: string
  contentHtml?: string
  description?: string
  folderId?: string | null
  sharingType?: SnippetSharingType
  isFavorite?: boolean
}
export interface UpdateSnippetInput {
  title?: string
  content?: string
  contentHtml?: string
  description?: string
  folderId?: string | null
  sharingType?: SnippetSharingType
  isFavorite?: boolean
}
/**
 * Input types for folder operations
 */
export interface CreateFolderInput {
  name: string
  description?: string
  parentId?: string | null
}
export interface UpdateFolderInput {
  name?: string
  description?: string
  parentId?: string | null
}
/**
 * Input types for sharing operations
 */
export interface SharingInput {
  sharingType: SnippetSharingType
  shares?: Array<{
    groupId?: string
    memberId?: string
    permission: 'VIEW' | 'EDIT'
  }>
}
/**
 * Snippet type (simplified from DB model)
 */
export interface Snippet {
  id: string
  title: string
  content: string
  contentHtml?: string
  description?: string
  folderId?: string | null
  sharingType: SnippetSharingType
  isFavorite: boolean
  isDeleted: boolean
  usageCount: number
  createdAt: Date
  updatedAt: Date
  createdById: string
  organizationId: string
}
/**
 * Folder type (simplified from DB model)
 */
export interface SnippetFolder {
  id: string
  name: string
  description?: string
  parentId?: string | null
  organizationId: string
  createdById: string
  createdAt: Date
  updatedAt: Date
  _count?: {
    snippets: number
  }
  subfolders?: SnippetFolder[]
}
/**
 * Panel state for resizable panels
 */
export interface PanelState {
  isCollapsed: boolean
  size: number
  defaultSize: number
  minSize: number
}
/**
 * Context state interface
 */
export interface SnippetContextState {
  // Current selections
  selectedFolderId: string | null
  searchTerm: string
  // Dialog states
  createDialogOpen: boolean
  editDialogOpen: boolean
  editingSnippet: Snippet | null
  // Panel state
  folderPanelState: PanelState
  // Loading states
  isCreatingSnippet: boolean
  isUpdatingSnippet: boolean
  isDeletingSnippet: boolean
  isCreatingFolder: boolean
  isUpdatingFolder: boolean
  isDeletingFolder: boolean
}
