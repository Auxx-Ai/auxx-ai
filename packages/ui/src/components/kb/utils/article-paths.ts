// packages/ui/src/components/kb/utils/article-paths.ts

import { type ArticleTreeFields, buildArticleTree } from './article-tree'

export interface ArticleSlugFields extends ArticleTreeFields {
  slug: string
  articleKind?: 'page' | 'category' | 'header' | 'tab' | 'link'
}

/**
 * Walk parentId building a slash-joined slug. Tabs and headers participate
 * in URLs alongside pages and categories; only the KB itself is implicit.
 */
export function getFullSlugPath<T extends ArticleSlugFields>(article: T, allArticles: T[]): string {
  if (!article) return ''
  // Defensive: a link's slug stores an external URL — it must never compose
  // into an internal route. Links are leaves, so this only triggers when
  // the link itself is the target.
  if (article.articleKind === 'link') return ''
  const slugs: string[] = [article.slug]
  let currentId = article.parentId
  while (currentId) {
    const parent = allArticles.find((a) => a.id === currentId)
    if (!parent) break
    slugs.unshift(parent.slug)
    currentId = parent.parentId
  }
  return slugs.join('/')
}

/**
 * Depth-first walk of `parentId`'s descendants for the first navigable child.
 * Tabs and headers are pure containers with no body of their own — skip them
 * and recurse into headers (tabs only sit at the root). Pass `null` for the
 * KB-root walk used by tab-less landings.
 *
 * `publishedOnly` filters out drafts; the public site sets it true, the admin
 * tree leaves it false so a freshly-created tab can resolve its first page
 * before anything is published.
 */
export function findFirstNavigableUnder<T extends ArticleSlugFields & { isPublished?: boolean }>(
  parentId: string | null,
  articles: T[],
  options?: { publishedOnly?: boolean }
): T | undefined {
  const publishedOnly = options?.publishedOnly ?? false
  const children = articles
    .filter((a) => a.parentId === parentId && (!publishedOnly || a.isPublished !== false))
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
  for (const child of children) {
    if (child.articleKind === 'header') {
      const grand = findFirstNavigableUnder(child.id, articles, options)
      if (grand) return grand
      continue
    }
    if (child.articleKind === 'tab') continue
    // Link kinds aren't navigable to as an internal route — they open
    // external. Skip them when picking the first navigable descendant.
    if (child.articleKind === 'link') continue
    return child
  }
  return undefined
}

interface ParentLinkArticle extends ArticleSlugFields {
  title: string
  emoji?: string | null
}

/**
 * Resolves the parent breadcrumb for `KBArticleRenderer`. Returns `undefined`
 * when the article has no parent. Pages and headers are navigable (a header
 * URL redirects to its first descendant on the public site); tabs and
 * categories aren't, so their `href` is `null` and the renderer falls back
 * to plain text.
 */
export function getArticleParentLink<T extends ParentLinkArticle>(
  article: T | undefined | null,
  allArticles: T[],
  basePath: string
): { title: string; emoji?: string | null; href: string | null } | undefined {
  if (!article?.parentId) return undefined
  const parent = allArticles.find((a) => a.id === article.parentId)
  if (!parent) return undefined
  const navigable = parent.articleKind === 'page' || parent.articleKind === 'header'
  return {
    title: parent.title,
    emoji: parent.emoji,
    href: navigable ? `${basePath}/${getFullSlugPath(parent, allArticles)}` : null,
  }
}

export function findArticleBySlugPath<T extends ArticleSlugFields>(
  allArticles: T[],
  slugPath: string[]
): T | undefined {
  if (!allArticles || !slugPath || slugPath.length === 0) return undefined

  const fullSlugPath = slugPath.join('/')

  for (const article of allArticles) {
    if (getFullSlugPath(article, allArticles) === fullSlugPath) return article
  }

  const lastSlug = slugPath[slugPath.length - 1]
  const articlesWithLastSlug = allArticles.filter((a) => a.slug === lastSlug)
  if (articlesWithLastSlug.length === 1) return articlesWithLastSlug[0]

  const tree = buildArticleTree(allArticles)
  let current = tree as Array<T & { children: Array<T & { children: T[] }> }>
  let foundArticle: T | undefined

  for (let i = 0; i < slugPath.length; i++) {
    const segment = slugPath[i]
    const match = current.find((a) => a.slug === segment)
    if (!match) break
    if (i === slugPath.length - 1) {
      foundArticle = match
      break
    }
    if (!match.children || match.children.length === 0) break
    current = match.children as Array<T & { children: Array<T & { children: T[] }> }>
  }
  if (foundArticle) return foundArticle

  if (articlesWithLastSlug.length > 1) {
    const scored = articlesWithLastSlug.map((article) => {
      const articleSlugs = getFullSlugPath(article, allArticles).split('/')
      let matchScore = 0
      for (let i = 0; i < Math.min(articleSlugs.length, slugPath.length); i++) {
        if (articleSlugs[articleSlugs.length - 1 - i] === slugPath[slugPath.length - 1 - i]) {
          matchScore++
        } else {
          break
        }
      }
      return { article, matchScore }
    })
    const best = scored.sort((a, b) => b.matchScore - a.matchScore)[0]
    if (best && best.matchScore > 0) return best.article
  }

  return undefined
}

export function isArticleActive<T extends ArticleSlugFields>(
  article: T,
  pathname: string,
  basePath: string,
  articleSlugPaths: Record<string, string> = {}
): boolean {
  if (!pathname || !basePath || !article) return false

  const fullSlugPath = articleSlugPaths[article.id] || getFullSlugPath(article, [article])
  const articlePath = `${basePath}/articles/${fullSlugPath}`
  const editorPath = `${basePath}/editor/~/${fullSlugPath}`

  if (pathname === articlePath || pathname === editorPath) return true
  if (pathname === `${editorPath}?panel=articles` || pathname.startsWith(`${editorPath}?`))
    return true
  if (pathname.startsWith(`${editorPath}/`) || pathname.startsWith(`${articlePath}/`)) return false

  return false
}

export function getArticleSlugPaths<T extends ArticleSlugFields>(
  articles: T[]
): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const article of articles) {
    paths[article.id] = getFullSlugPath(article, articles)
  }
  return paths
}

/**
 * URL for the in-app fullscreen preview route
 * (`/preview/kb/{kbId}/{...articleSlug}`). Pass the slug path either as an
 * array of segments or as a slash-joined string.
 */
export function getKbPreviewHref(kbId: string, slugPath: string[] | string = []): string {
  const segments = typeof slugPath === 'string' ? (slugPath ? slugPath.split('/') : []) : slugPath
  const segment = segments.length > 0 ? `/${segments.map(encodeURIComponent).join('/')}` : ''
  return `/preview/kb/${kbId}${segment}`
}
