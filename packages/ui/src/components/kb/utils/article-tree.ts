// packages/ui/src/components/kb/utils/article-tree.ts

/**
 * Minimal fields required to compute article ordering and parent relationships.
 * Both admin and public KB consumers extend this shape.
 */
export interface ArticleTreeFields {
  id: string
  parentId: string | null
  order: number
}

export type ArticleTreeNode<T extends ArticleTreeFields> = T & {
  children: Array<ArticleTreeNode<T>>
}

export function buildArticleTree<T extends ArticleTreeFields>(
  articles: T[],
  parentId: string | null = null
): Array<ArticleTreeNode<T>> {
  return articles
    .filter((article) => article.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((article) => ({
      ...article,
      children: buildArticleTree(articles, article.id),
    })) as Array<ArticleTreeNode<T>>
}

export function flattenArticleTreePreservingChildren<T extends { children?: T[] }>(tree: T[]): T[] {
  const result: T[] = []
  const walk = (nodes: T[]) => {
    for (const node of nodes) {
      result.push(node)
      if (node.children && node.children.length > 0) walk(node.children)
    }
  }
  walk(tree)
  return result
}

export function flattenArticleTree<T extends { id: string; children?: T[] }>(
  tree: T[],
  parentId: string | null = null,
  result: Array<T & { parentId: string | null; order: number }> = []
): Array<T & { parentId: string | null; order: number }> {
  tree.forEach((article, index) => {
    result.push({ ...article, parentId, order: index })
    if (article.children && article.children.length > 0) {
      flattenArticleTree(article.children, article.id, result)
    }
  })
  return result
}

export function findArticleById<T extends { id: string }>(
  articles: T[],
  id: string
): T | undefined {
  return articles.find((article) => article.id === id)
}

export function findAncestorIds<T extends { id: string; children?: T[] }>(
  items: T[],
  targetId: string,
  current: string[] = []
): string[] | null {
  for (const item of items) {
    if (item.id === targetId) return current
    if (item.children && item.children.length > 0) {
      const result = findAncestorIds(item.children, targetId, [...current, item.id])
      if (result !== null) return result
    }
  }
  return null
}

export function findArticleAndParent<T extends { id: string; children?: T[] }>(
  tree: T[],
  id: string
): [T | null, T | null] {
  for (const node of tree) {
    if (node.id === id) return [node, null]
    if (node.children) {
      for (const child of node.children) {
        if (child.id === id) return [child, node]
      }
      const [found, parent] = findArticleAndParent(node.children, id)
      if (found) return [found, parent || node]
    }
  }
  return [null, null]
}
