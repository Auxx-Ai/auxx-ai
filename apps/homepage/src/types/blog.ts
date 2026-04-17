// apps/homepage/src/types/blog.ts

export interface Author {
  name: string
  image: string
}

export interface Category {
  slug: string
  title: string
}

export interface FaqItem {
  question: string
  answer: string
}

export interface BlogPost {
  title: string
  description: string
  slug: string
  date: string
  image: string
  category: Category
  authors: Author[]
  tags: string[]
  readingTime: string
  published: boolean
  faq?: FaqItem[]
}
