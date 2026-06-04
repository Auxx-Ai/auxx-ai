// apps/web/src/components/kb/ui/editor/article-editor-surface.tsx
'use client'

import { createContext, useContext, useMemo } from 'react'
import type { ArticleMeta } from '../../store/article-store'

/** Builds the href an article link should point at. */
export type ArticleHrefBuilder = (article: ArticleMeta) => string

/** How an embedding surface customizes the shared article editor. */
export interface ArticleEditorSurface {
  /**
   * Overrides where the editor's internal links (footer prev/next) point. The KB
   * editor route uses its default slug-based href; surfaces that embed the editor
   * elsewhere — e.g. the source workspace — keep navigation inside their route.
   */
  buildHref?: ArticleHrefBuilder
  /**
   * Hide the publish/unpublish cluster (status pill, publish, archive, delete) and
   * the Preview link. Set by surfaces whose knowledge base isn't independently
   * publishable, like the source workspace — a source's owned KB has no public site.
   */
  hidePublishing?: boolean
}

const ArticleEditorSurfaceContext = createContext<ArticleEditorSurface | null>(null)

/**
 * Provides surface-level overrides to a `ArticleEditor` embedded outside the KB
 * editor route. Pass stable `buildHref` (hoist it to module scope) so the memo
 * holds and the editor subtree doesn't re-render on every parent render.
 */
export function ArticleEditorSurfaceProvider({
  buildHref,
  hidePublishing = false,
  children,
}: {
  buildHref?: ArticleHrefBuilder
  hidePublishing?: boolean
  children: React.ReactNode
}) {
  const value = useMemo<ArticleEditorSurface>(
    () => ({ buildHref, hidePublishing }),
    [buildHref, hidePublishing]
  )
  return (
    <ArticleEditorSurfaceContext.Provider value={value}>
      {children}
    </ArticleEditorSurfaceContext.Provider>
  )
}

/** Surface overrides for the current editor, or empty defaults on the KB route. */
export function useArticleEditorSurface(): ArticleEditorSurface {
  return useContext(ArticleEditorSurfaceContext) ?? {}
}
