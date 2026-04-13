// apps/homepage/src/app/blog/category/[slug]/page.tsx

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllCategories, getPostsByCategory } from '~/lib/blog'
import { config } from '~/lib/config'
import { BlogFilter } from '../../_components/blog-filter'
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
    <>
      <div className='mx-auto max-w-5xl px-6 pb-8'>
        <div className='mx-auto max-w-3xl text-center'>
          <h1 className='mb-4 text-balance text-5xl font-semibold md:text-6xl'>Blog</h1>
          <p className='text-muted-foreground text-balance text-lg'>
            Insights on AI-powered customer support, e-commerce automation, and growing your Shopify
            business.
          </p>
        </div>
      </div>

      <BlogFilter categories={categories} />
      <BlogListWithPagination posts={posts} />
    </>
  )
}
