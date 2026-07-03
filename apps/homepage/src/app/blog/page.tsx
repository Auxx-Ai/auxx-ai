// apps/homepage/src/app/blog/page.tsx

import type { Metadata } from 'next'
import { getAllCategories, getAllPosts } from '~/lib/blog'
import { config } from '~/lib/config'
import { BlogLayout } from './_components/blog-layout'
import { BlogListWithPagination } from './_components/blog-list-with-pagination'

// Re-render hourly so future-dated posts appear on their release date.
export const revalidate = 3600

export const metadata: Metadata = {
  title: `Blog | ${config.shortName}`,
  description:
    'Insights on AI-powered customer support, e-commerce automation, and growing your Shopify business.',
}

export default function BlogPage() {
  const posts = getAllPosts()
  const categories = getAllCategories()

  return (
    <BlogLayout categories={categories}>
      <BlogListWithPagination posts={posts} />
    </BlogLayout>
  )
}
