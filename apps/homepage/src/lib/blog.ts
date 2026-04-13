// apps/homepage/src/lib/blog.ts

import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import readingTime from 'reading-time'
import type { BlogPost, Category } from '~/types/blog'

const CONTENT_DIR = path.join(process.cwd(), 'content', 'blog')

function parseMdxFile(filePath: string): BlogPost | null {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)

  if (!data.published) return null

  const stats = readingTime(content)

  return {
    title: data.title,
    description: data.description,
    slug: data.slug,
    date: data.date,
    image: data.image ?? '/blog/default-og.jpg',
    category: {
      slug: data.category?.slug ?? 'uncategorized',
      title: data.category?.title ?? 'Uncategorized',
    },
    authors: data.authors ?? [{ name: 'Auxx AI', image: '/blog/default-author.jpg' }],
    tags: data.tags ?? [],
    readingTime: stats.text,
    published: data.published,
  }
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(CONTENT_DIR)) return []

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.mdx'))

  const posts = files
    .map((file) => parseMdxFile(path.join(CONTENT_DIR, file)))
    .filter((post): post is BlogPost => post !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return posts
}

export function getPostBySlug(slug: string): { post: BlogPost; content: string } | null {
  if (!fs.existsSync(CONTENT_DIR)) return null

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.mdx'))

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file)
    const raw = fs.readFileSync(filePath, 'utf-8')
    const { data, content } = matter(raw)

    if (data.slug === slug && data.published) {
      const stats = readingTime(content)
      return {
        post: {
          title: data.title,
          description: data.description,
          slug: data.slug,
          date: data.date,
          image: data.image ?? '/blog/default-og.jpg',
          category: {
            slug: data.category?.slug ?? 'uncategorized',
            title: data.category?.title ?? 'Uncategorized',
          },
          authors: data.authors ?? [{ name: 'Auxx AI', image: '/blog/default-author.jpg' }],
          tags: data.tags ?? [],
          readingTime: stats.text,
          published: data.published,
        },
        content,
      }
    }
  }

  return null
}

export function getAllSlugs(): string[] {
  return getAllPosts().map((p) => p.slug)
}

export function getAllCategories(): Category[] {
  const posts = getAllPosts()
  const categoryMap = new Map<string, string>()

  for (const post of posts) {
    if (!categoryMap.has(post.category.slug)) {
      categoryMap.set(post.category.slug, post.category.title)
    }
  }

  return Array.from(categoryMap, ([slug, title]) => ({ slug, title }))
}

export function getPostsByCategory(categorySlug: string): BlogPost[] {
  return getAllPosts().filter((p) => p.category.slug === categorySlug)
}
