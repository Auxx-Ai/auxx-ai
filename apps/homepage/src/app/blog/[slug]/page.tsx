// apps/homepage/src/app/blog/[slug]/page.tsx

import rehypeShiki from '@shikijs/rehype'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MDXRemote } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import { getAllSlugs, getPostBySlug } from '~/lib/blog'
import { config } from '~/lib/config'
import { mdxComponents } from '../_components/mdx-components'
import { PostHeader } from '../_components/post-header'

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const result = getPostBySlug(slug)

  if (!result) {
    return { title: 'Post Not Found' }
  }

  const { post } = result
  const url = `${config.urls.homepage}/blog/${slug}`

  return {
    title: `${post.title} | ${config.shortName}`,
    description: post.description,
    openGraph: {
      title: `${post.title} | ${config.shortName}`,
      description: post.description,
      url,
      type: 'article',
      publishedTime: new Date(post.date).toISOString(),
      images: [{ url: post.image, width: 1200, height: 675 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${post.title} | ${config.shortName}`,
      description: post.description,
      images: [{ url: post.image, width: 1200, height: 675 }],
    },
    alternates: {
      canonical: url,
    },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const result = getPostBySlug(slug)

  if (!result) {
    notFound()
  }

  const { post, content } = result

  return (
    <>
      <PostHeader post={post} />

      <div className='mx-auto max-w-2xl px-6'>
        <MDXRemote
          source={content}
          components={mdxComponents}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
              rehypePlugins: [
                [
                  rehypeShiki,
                  {
                    themes: {
                      light: 'github-light',
                      dark: 'vesper',
                    },
                  },
                ],
              ],
            },
          }}
        />
      </div>

      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: post.title,
            description: post.description,
            image: post.image,
            datePublished: new Date(post.date).toISOString(),
            author: post.authors.map((a) => ({
              '@type': 'Person',
              name: a.name,
            })),
            publisher: {
              '@type': 'Organization',
              name: 'Auxx AI',
            },
          }),
        }}
      />
    </>
  )
}
