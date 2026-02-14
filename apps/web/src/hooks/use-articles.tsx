import { keepPreviousData } from '@tanstack/react-query'
// import { getQueryKey } from '@trpc/react-query'
// import { useMemo } from 'react'
import { api } from '~/trpc/react'

export type ArticleCategory = {
  id: string
  name: string
  parentId: string | null
  userId: string
  createdAt: string
}

export type Article = {
  id: string
  title: string
  categoryId: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  updatedAt: string
  viewsCount: number
  authorId: string
}
export type CategoryNode = {
  category: ArticleCategory
  subcategories: CategoryNode[]
  articles: Article[]
}

export const useArticles = () => {
  // const queryKey = getQueryKey(api.product.getProducts, {}, 'query')

  const { isFetching, refetch, data } = api.article.withCategories.useQuery(
    {},
    { placeholderData: keepPreviousData }
  )

  const rootCategories: CategoryNode[] = []
  let articles: Article[] = []
  let categories: ArticleCategory[] = []

  if (data?.categories && data.articles) {
    // const { categories, articles } = data
    categories = data.categories ?? []
    articles = data.articles ?? []

    // if (categories.length === 0) return

    // Create a map for quick access to categories by ID
    const categoryMap = new Map<string, CategoryNode>()

    // Initialize category nodes with empty subcategories and articles arrays
    categories.forEach((category) => {
      categoryMap.set(category.id, { category, subcategories: [], articles: [] })
    })

    // Assign articles to their categories
    articles.forEach((article) => {
      if (article.categoryId) {
        const categoryNode = categoryMap.get(article.categoryId)
        if (categoryNode) {
          categoryNode.articles.push(article)
        }
      }
    })

    // Build the tree structure by assigning children to their parents

    categories.forEach((category) => {
      const node = categoryMap.get(category.id)!

      if (category.parentId) {
        // This is a subcategory
        const parentNode = categoryMap.get(category.parentId)
        if (parentNode) {
          parentNode.subcategories.push(node)
        }
      } else {
        // This is a root category
        rootCategories.push(node)
      }
    })
  }

  // const products = useMemo(
  //   () => data?.pages?.flatMap((page) => page.products) ?? [],
  //   [data]
  // )
  // console.log('products', products)
  // const products = result.data ?? []
  // const products = { data: [] }

  return { isFetching, rootCategories, articles, categories, refetch, tags: data?.tags ?? [] }
}
