// packages/ui/src/components/kb/article/kb-article-pager.tsx

import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import type { ArticleSlugFields } from '../utils/article-paths'
import { getFullSlugPath } from '../utils/article-paths'

interface PagerArticle extends ArticleSlugFields {
  title: string
  emoji?: string | null
}

interface KBArticlePagerProps<T extends PagerArticle> {
  articles: T[]
  prev?: T
  next?: T
  basePath: string
}

export function KBArticlePager<T extends PagerArticle>({
  articles,
  prev,
  next,
  basePath,
}: KBArticlePagerProps<T>) {
  if (!prev && !next) return null
  return (
    <nav className='mt-12 grid grid-cols-1 gap-3 @kb-md:grid-cols-2'>
      {prev ? (
        <PagerLink article={prev} articles={articles} basePath={basePath} direction='prev' />
      ) : (
        <span />
      )}
      {next ? (
        <PagerLink article={next} articles={articles} basePath={basePath} direction='next' />
      ) : null}
    </nav>
  )
}

interface PagerLinkProps<T extends PagerArticle> {
  article: T
  articles: T[]
  basePath: string
  direction: 'prev' | 'next'
}

function PagerLink<T extends PagerArticle>({
  article,
  articles,
  basePath,
  direction,
}: PagerLinkProps<T>) {
  const href = `${basePath}/${getFullSlugPath(article, articles)}`
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        'group block rounded-[var(--kb-radius)] border border-[var(--kb-border)] p-4 no-underline transition-colors',
        'hover:border-[var(--kb-primary)]',
        direction === 'next' && '@kb-md:col-start-2 @kb-md:text-right'
      )}>
      <span className='block text-xs text-[var(--kb-fg)]/60'>
        {direction === 'prev' ? '← Previous' : 'Next →'}
      </span>
      <span className='mt-1 block text-base font-medium text-[var(--kb-fg)] group-hover:text-[var(--kb-primary)]'>
        {article.emoji ? <span className='mr-1.5'>{article.emoji}</span> : null}
        {article.title}
      </span>
    </Link>
  )
}
