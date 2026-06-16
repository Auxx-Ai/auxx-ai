// apps/web/src/components/mail/email-editor/hooks/use-snippet-search.ts

import { useMemo } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

export type SnippetEntity = RouterOutputs['snippet']['all']['snippets'][number]
export type SnippetFolderEntity = RouterOutputs['snippet']['getFolders']['folders'][number]

export interface UseSnippetSearchOptions {
  /** Lowercased search query typed into the open `/` chip. Empty = browse mode. */
  query: string
  /** The folder the picker is drilled into, or null at the Snippets scope root. */
  currentFolderId: string | null
  /** Whether the slash menu is at its absolute root (drives cross-folder search). */
  isAtRoot: boolean
}

export interface UseSnippetSearchResult {
  /** Every snippet in the org (for id lookups on insert). */
  allSnippets: SnippetEntity[]
  /** True while the snippet list is still being fetched. */
  loading: boolean
  /** Browse view: snippets directly in the current level. */
  currentSnippets: SnippetEntity[]
  /** Browse view: folders directly in the current level. */
  currentFolders: SnippetFolderEntity[]
  /**
   * Search results scoped to the current folder + all its subfolders
   * (excludes the parent folder and siblings). At the Snippets scope root this
   * is the whole library. Empty when not searching.
   */
  subtreeSnippetResults: SnippetEntity[]
  /** Cross-folder search across the whole library, only at the menu root. */
  rootSnippetResults: SnippetEntity[]
}

/**
 * Owns the snippet + folder queries for the mail slash menu and derives the
 * browse and search views. Search recurses the current folder's subtree rather
 * than the single drilled level, so snippets nested in subfolders are found.
 */
export function useSnippetSearch({
  query,
  currentFolderId,
  isAtRoot,
}: UseSnippetSearchOptions): UseSnippetSearchResult {
  const { data: snippetsData, isLoading: loading } = api.snippet.all.useQuery(
    {},
    { staleTime: 5 * 60 * 1000 }
  )
  const allSnippets = snippetsData?.snippets ?? []

  const { data: foldersData } = api.snippet.getFolders.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })
  const allFolders = foldersData?.folders ?? []

  const q = query.toLowerCase()

  // Browse view: the direct children of the current level.
  const currentSnippets = useMemo(
    () =>
      allSnippets.filter((s) => (currentFolderId ? s.folderId === currentFolderId : !s.folderId)),
    [allSnippets, currentFolderId]
  )

  const currentFolders = useMemo(
    () =>
      allFolders.filter((f) => (currentFolderId ? f.parentId === currentFolderId : !f.parentId)),
    [allFolders, currentFolderId]
  )

  // Current folder + all descendant folders (excludes parent + siblings). null
  // at the Snippets scope root = no folder restriction (the whole library).
  const subtreeFolderIds = useMemo(() => {
    if (!currentFolderId) return null
    const childrenByParent = new Map<string, string[]>()
    for (const f of allFolders) {
      if (!f.parentId) continue
      const siblings = childrenByParent.get(f.parentId) ?? []
      siblings.push(f.id)
      childrenByParent.set(f.parentId, siblings)
    }
    const ids = new Set<string>([currentFolderId])
    const queue = [currentFolderId]
    while (queue.length > 0) {
      const id = queue.pop()
      if (!id) continue
      for (const child of childrenByParent.get(id) ?? []) {
        if (!ids.has(child)) {
          ids.add(child)
          queue.push(child)
        }
      }
    }
    return ids
  }, [allFolders, currentFolderId])

  // Searching inside the Snippets scope recurses the subtree (current folder +
  // all subfolders), flattening matches — not just the current level.
  const subtreeSnippetResults = useMemo(() => {
    if (!q) return []
    return allSnippets.filter((s) => {
      if (!s.title.toLowerCase().includes(q)) return false
      if (!subtreeFolderIds) return true
      return s.folderId ? subtreeFolderIds.has(s.folderId) : false
    })
  }, [q, allSnippets, subtreeFolderIds])

  // Cross-folder snippet search when typing at the menu root.
  const rootSnippetResults = useMemo(() => {
    if (!isAtRoot || !q) return []
    return allSnippets.filter((s) => s.title.toLowerCase().includes(q))
  }, [isAtRoot, allSnippets, q])

  return {
    allSnippets,
    loading,
    currentSnippets,
    currentFolders,
    subtreeSnippetResults,
    rootSnippetResults,
  }
}
