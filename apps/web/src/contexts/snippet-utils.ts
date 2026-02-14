import type { Snippet, SnippetFolder } from './snippet-types'

/**
 * Generate a temporary ID for optimistic updates
 */
export function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create an optimistic snippet for immediate UI updates
 */
export function createOptimisticSnippet(
  data: Partial<Snippet> & { title: string; content: string }
): Snippet {
  return {
    id: generateTempId(),
    title: data.title,
    content: data.content,
    contentHtml: data.contentHtml || '',
    description: data.description || '',
    folderId: data.folderId || null,
    sharingType: data.sharingType || ('PRIVATE' as any),
    isFavorite: data.isFavorite || false,
    isDeleted: false,
    usageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: '', // Will be set by server
    organizationId: '', // Will be set by server
    ...data,
  }
}

/**
 * Create an optimistic folder for immediate UI updates
 */
export function createOptimisticFolder(data: {
  name: string
  description?: string
  parentId?: string | null
}): SnippetFolder {
  return {
    id: generateTempId(),
    name: data.name,
    description: data.description || '',
    parentId: data.parentId || null,
    organizationId: '', // Will be set by server
    createdById: '', // Will be set by server
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { snippets: 0 },
    subfolders: [],
  }
}

/**
 * Build breadcrumb trail from folder hierarchy
 */
export function buildBreadcrumbTrail(
  folderId: string | null,
  folders: SnippetFolder[]
): Array<{ title: string; href?: string }> {
  const baseBreadcrumbs = [{ title: 'Snippets', href: '/app/settings/snippets' }]

  if (!folderId || !folders) {
    return baseBreadcrumbs
  }

  const folderTrail: Array<{ title: string; href?: string }> = []
  const currentFolder = folders.find((f) => f.id === folderId)

  if (currentFolder) {
    folderTrail.unshift({ title: currentFolder.name })

    let parentId = currentFolder.parentId
    while (parentId) {
      const parentFolder = folders.find((f) => f.id === parentId)
      if (parentFolder) {
        folderTrail.unshift({
          title: parentFolder.name,
          href: `/app/settings/snippets?folder=${parentFolder.id}`,
        })
        parentId = parentFolder.parentId
      } else {
        break
      }
    }
  }

  return [...baseBreadcrumbs, ...folderTrail]
}

/**
 * Get current folder name from hierarchy
 */
export function getCurrentFolderName(
  folderId: string | null,
  folders: SnippetFolder[]
): string | null {
  if (!folderId || !folders) return null
  const folder = folders.find((f) => f.id === folderId)
  return folder?.name || null
}

/**
 * Check if a folder is a temporary/optimistic folder
 */
export function isTempFolder(folderId: string): boolean {
  return folderId.startsWith('temp-')
}

/**
 * Check if a snippet is a temporary/optimistic snippet
 */
export function isTempSnippet(snippetId: string): boolean {
  return snippetId.startsWith('temp-')
}

/**
 * Validate panel size constraints
 */
export function validatePanelSize(size: number, minSize: number, maxSize: number): number {
  return Math.max(minSize, Math.min(maxSize, size))
}

/**
 * Calculate panel sizes when one is collapsed
 */
export function calculatePanelSizes(
  isCollapsed: boolean,
  currentSize: number,
  defaultSize: number,
  minSize: number
): { size: number; shouldCollapse: boolean } {
  if (isCollapsed) {
    return { size: 0, shouldCollapse: true }
  }

  // If expanding, use default size or current size if it's valid
  const expandedSize = currentSize < minSize ? defaultSize : currentSize
  return { size: expandedSize, shouldCollapse: false }
}
