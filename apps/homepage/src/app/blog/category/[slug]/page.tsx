// apps/homepage/src/app/blog/category/[slug]/page.tsx

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllCategories, getPostsByCategory } from '~/lib/blog'
import { config } from '~/lib/config'
import { BlogLayout } from '../../_components/blog-layout'
import { BlogListWithPagination } from '../../_components/blog-list-with-pagination'

export function generateStaticParams() {
  return getAllCategories().map((cat) => ({ slug: cat.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const categories = getAllCategories()
  const category = categories.find((c) => c.slug === slug)

  if (!category) {
    return { title: 'Category Not Found' }
  }

  return {
    title: `${category.title} | Blog | ${config.shortName}`,
    description: `Browse ${category.title} articles on the ${config.shortName} blog.`,
  }
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const posts = getPostsByCategory(slug)
  const categories = getAllCategories()

  if (posts.length === 0) {
    notFound()
  }

  return (
    <BlogLayout categories={categories}>
      <BlogListWithPagination posts={posts} />
    </BlogLayout>
  )
}
