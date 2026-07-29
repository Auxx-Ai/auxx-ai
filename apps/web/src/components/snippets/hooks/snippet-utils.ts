// apps/web/src/components/snippets/hooks/snippet-utils.ts

import type { SnippetFolder } from './snippet-types'

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
