// src/app/(protected)/app/kb/_components/helpers.tsx
import type { Article } from './kb-sidebar'

/**
 * Build a hierarchical tree structure from a flat array of articles
 * @param articles Flat array of articles
 * @param parentId Parent ID to start building from (null for root)
 * @returns Nested tree structure of articles
 */
export const buildArticleTree = (
  articles: Article[],
  parentId: string | null = null
): Article[] => {
  return articles
    .filter((article) => article.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((article) => ({
      ...article,
      children: buildArticleTree(articles, article.id),
    }))
}

/**
 * Flattens a tree while preserving children arrays
 * @param tree Tree of articles
 * @returns Flattened array of articles
 */
export const flattenArticleTreePreservingChildren = (tree: Article[]): Article[] => {
  const result: Article[] = []

  const flatten = (nodes: Article[]) => {
    nodes.forEach((node) => {
      result.push(node)
      if (node.children && node.children.length > 0) {
        flatten(node.children)
      }
    })
  }

  flatten(tree)
  return result
}

/**
 * Generate paths for articles in a tree
 * @param articles Flat array of articles
 * @returns Articles with added path and orderPath properties
 */
export const generateArticlePaths = (articles: Article[]): Article[] => {
  // Build the tree first
  const tree = buildArticleTree(articles)

  // Generate paths for each node
  const generatePaths = (nodes: Article[], parentPath = '', parentOrderPath = ''): Article[] => {
    return nodes.map((node, index) => {
      // Format index with padding for correct string sorting
      const orderIndex = index.toString().padStart(5, '0')

      // Create paths
      const path = parentPath ? `${parentPath}/${node.id}` : `/${node.id}`
      const orderPath = parentOrderPath ? `${parentOrderPath}/${orderIndex}` : orderIndex

      // Assign to node
      node.path = path
      node.orderPath = orderPath

      // Process children
      if (node.children && node.children.length > 0) {
        node.children = generatePaths(node.children, path, orderPath)
      }

      return node
    })
  }

  // Generate paths for the entire tree
  const treeWithPaths = generatePaths(tree)

  // Flatten back to array while preserving hierarchies
  return flattenArticleTreePreservingChildren(treeWithPaths)
}

/**
 * Find article by ID in a flat array
 * @param articles Flat array of articles
 * @param id ID to find
 * @returns Found article or undefined
 */
export function findArticleById(articles: Article[], id: string): Article | undefined {
  return articles.find((article) => article.id === id)
}

/**
 * Flatten a tree of articles into a list with calculated order
 * @param articleTree Tree of articles
 * @param parentId Parent ID for current level
 * @param result Accumulator for recursion
 * @returns Flattened array with order and parentId
 */
export const flattenArticleTree = (
  articleTree: Article[],
  parentId: string | null = null,
  result: (Article & { parentId: string | null; order: number })[] = []
): (Article & { parentId: string | null; order: number })[] => {
  articleTree.forEach((article, index) => {
    const flatNode = { ...article, parentId: parentId, order: index }

    result.push(flatNode)

    if (article.children && article.children.length > 0) {
      flattenArticleTree(article.children, article.id, result)
    }
  })
  return result
}

/**
 * Build a full slug path for an article by traversing its parent chain
 * @param article The article to get the slug path for
 * @param allArticles All articles in the knowledge base
 * @returns The full slug path as a string
 */
export const getFullSlugPath = (article: Article, allArticles: Article[]): string => {
  if (!article) return ''

  const slugs: string[] = [article.slug]

  // Follow parent chain
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
 * Find an article and its parent in a tree structure
 * @param tree Article tree to search
 * @param id ID to find
 * @returns Tuple of [found article, parent article]
 */
export const findArticleAndParent = (
  tree: Article[],
  id: string
): [Article | null, Article | null] => {
  for (const node of tree) {
    if (node.id === id) {
      return [node, null]
    }

    if (node.children) {
      for (const child of node.children) {
        if (child.id === id) {
          return [child, node]
        }
      }

      const [found, parent] = findArticleAndParent(node.children, id)
      if (found) {
        return [found, parent || node]
      }
    }
  }

  return [null, null]
}

/**
 * Find an article by its slug path with robust fallback mechanisms
 * @param allArticles Flat array of all articles
 * @param slugPath Array of slug segments from URL
 * @returns The found article or undefined
 */
export function findArticleBySlugPath(
  allArticles: Article[],
  slugPath: string[]
): Article | undefined {
  if (!allArticles || !slugPath || slugPath.length === 0) {
    return undefined
  }

  // Join the slugs for easier comparison
  const fullSlugPath = slugPath.join('/')

  // 1. Try to find by exact slug path match first
  for (const article of allArticles) {
    // Get the article's full slug path
    const articleSlugPath = getFullSlugPath(article, allArticles)
    if (articleSlugPath === fullSlugPath) {
      return article
    }
  }

  // 2. Try to find by the last slug segment (useful after moves)
  const lastSlug = slugPath[slugPath.length - 1]

  // If there's only one article with this last slug, return it
  const articlesWithLastSlug = allArticles.filter((a) => a.slug === lastSlug)
  if (articlesWithLastSlug.length === 1) {
    return articlesWithLastSlug[0]
  }

  // 3. Use the existing path-based traversal as fallback
  const tree = buildArticleTree(allArticles)
  let current = tree
  let foundArticle: Article | undefined

  // Walk through the slug segments
  for (let i = 0; i < slugPath.length; i++) {
    const segment = slugPath[i]

    // Try to find a match at this level
    const match = current.find((a) => a.slug === segment)
    if (!match) {
      // No match at this level - give up on traditional traversal
      break
    }

    // If this is the last segment, we found it!
    if (i === slugPath.length - 1) {
      foundArticle = match
      break
    }

    // Continue to the next level if there are children
    if (!match.children || match.children.length === 0) {
      // No children but we need to go deeper - traversal failed
      break
    }

    current = match.children
  }

  if (foundArticle) {
    return foundArticle
  }

  // 4. Last resort: If we have multiple articles with the last slug,
  // use the one that best matches the full path
  if (articlesWithLastSlug.length > 1) {
    // Create array of scored matches
    const scoredMatches = articlesWithLastSlug.map((article) => {
      const articlePath = getFullSlugPath(article, allArticles)
      const articleSlugs = articlePath.split('/')

      // Count how many slug segments match from the end
      let matchScore = 0
      for (let i = 0; i < Math.min(articleSlugs.length, slugPath.length); i++) {
        if (articleSlugs[articleSlugs.length - 1 - i] === slugPath[slugPath.length - 1 - i]) {
          matchScore++
        } else {
          break // Stop counting when we hit a mismatch
        }
      }

      return { article, matchScore }
    })

    // Return the article with the highest match score
    const bestMatch = scoredMatches.sort((a, b) => b.matchScore - a.matchScore)[0]
    if (bestMatch && bestMatch.matchScore > 0) {
      return bestMatch.article
    }
  }

  // Cannot find the article
  return undefined
}

/**
 * Check if an article is active based on the current path
 * @param article Article to check
 * @param pathname Current path
 * @param basePath Base path for KB routes
 * @param articleSlugPaths Memoized slug paths for better performance
 * @returns Boolean indicating if article is active
 */
export const isArticleActive = (
  article: Article,
  pathname: string,
  basePath: string,
  articleSlugPaths: Record<string, string> = {}
): boolean => {
  if (!pathname || !basePath || !article) return false

  // Use memoized path if available, otherwise calculate
  const fullSlugPath = articleSlugPaths[article.id] || getFullSlugPath(article, [article])

  // Build paths to compare
  const articlePath = `${basePath}/articles/${fullSlugPath}`
  const editorPath = `${basePath}/editor/~/${fullSlugPath}`

  // Exact match
  if (pathname === articlePath || pathname === editorPath) {
    return true
  }

  // Check with query parameters
  if (pathname === `${editorPath}?tab=articles` || pathname.startsWith(`${editorPath}?`)) {
    return true
  }

  // Avoid matching child paths
  if (pathname.startsWith(`${editorPath}/`) || pathname.startsWith(`${articlePath}/`)) {
    return false
  }

  return false
}

/**
 * Check if an article or any of its children is active
 * @param article Article to check
 * @param currentPath Current path
 * @param basePath Base path for KB routes
 * @param allArticles All articles for resolving paths
 * @returns Boolean indicating if article or any child is active
 */
export const checkArticleOrChildrenActive = (
  article: Article,
  currentPath: string,
  basePath: string,
  allArticles: Article[]
): boolean => {
  // First check if the current article is active
  if (isArticleActive(article, currentPath, basePath)) {
    return true
  }

  // Then check children recursively
  if (article.children && article.children.length > 0) {
    return article.children.some((child) =>
      checkArticleOrChildrenActive(child, currentPath, basePath, allArticles)
    )
  }

  return false
}

/**
 * Recursively finds all ancestor IDs of a target article within a tree
 * @param items The current level of the article tree
 * @param targetId The ID of the article whose ancestors we need
 * @param currentAncestors The ancestors found so far
 * @returns Array of ancestor IDs or null if not found
 */
export const findAncestorIds = (
  items: Article[],
  targetId: string,
  currentAncestors: string[] = []
): string[] | null => {
  for (const item of items) {
    if (item.id === targetId) {
      return currentAncestors
    }
    if (item.children && item.children.length > 0) {
      const result = findAncestorIds(item.children, targetId, [...currentAncestors, item.id])
      if (result !== null) {
        return result
      }
    }
  }
  return null
}
