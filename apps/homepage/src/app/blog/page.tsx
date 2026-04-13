// apps/homepage/src/app/blog/page.tsx

import type { Metadata } from 'next'
import { getAllCategories, getAllPosts } from '~/lib/blog'
import { config } from '~/lib/config'
import { BlogFilter } from './_components/blog-filter'
import { BlogListWithPagination } from './_components/blog-list-with-pagination'

export const metadata: Metadata = {
  title: `Blog | ${config.shortName}`,
  description:
    'Insights on AI-powered customer support, e-commerce automation, and growing your Shopify business.',
}

export default function BlogPage() {
  const posts = getAllPosts()
  const categories = getAllCategories()

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
