// apps/web/src/components/kb/utils/article-paths.ts

import type { ArticleMeta } from '../store/article-store'
import { buildArticleTree } from './article-tree'

export function getFullSlugPath<T extends ArticleMeta>(article: T, allArticles: T[]): string {
  if (!article) return ''
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

export function findArticleBySlugPath<T extends ArticleMeta>(
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

export function isArticleActive<T extends ArticleMeta>(
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
  if (pathname === `${editorPath}?tab=articles` || pathname.startsWith(`${editorPath}?`))
    return true
  if (pathname.startsWith(`${editorPath}/`) || pathname.startsWith(`${articlePath}/`)) return false

  return false
}

export function getArticleSlugPaths<T extends ArticleMeta>(articles: T[]): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const article of articles) {
    paths[article.id] = getFullSlugPath(article, articles)
  }
  return paths
}
