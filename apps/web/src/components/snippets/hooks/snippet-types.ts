// apps/web/src/components/snippets/hooks/snippet-types.ts

import type { RouterOutputs } from '~/trpc/react'

/**
 * One row of `snippet.all` — the canonical client-side snippet shape.
 *
 * Derived from the router rather than re-declared: the hand-written interface
 * this replaces carried a `sharingType` field that plan 36 deleted, and nothing
 * caught the drift until the column went away. Sharing state is no longer a
 * property of the snippet at all — it lives in `ResourceAccess` and is read
 * through the shared instance-share surface.
 */
export type Snippet = RouterOutputs['snippet']['all']['snippets'][number]

/**
 * Input types for snippet operations
 */
export interface CreateSnippetInput {
  title: string
  content: string
  contentHtml?: string
  description?: string
  folderId?: string | null
}
export interface UpdateSnippetInput {
  title?: string
  content?: string
  contentHtml?: string
  description?: string
  folderId?: string | null
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
 * Folder type — matches what `snippet.getFolders` returns. Folders stay flat
 * labels with no per-folder grants (plan 36 decision 0.4); `_count.snippets` is
 * server-scoped to the snippets the caller may view.
 */
export interface SnippetFolder {
  id: string
  name: string
  description: string | null
  parentId: string | null
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
