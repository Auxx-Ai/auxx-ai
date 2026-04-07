// apps/web/src/components/kopilot/ui/blocks/docs-results-block.tsx

import { BookOpen, ExternalLink } from 'lucide-react'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { DocsResultsData } from './block-schemas'

export function DocsResultsBlock({ data }: BlockRendererProps<DocsResultsData>) {
  const { articles } = data

  if (articles.length === 0) return null

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='docs-results-block'
        indicator={<BookOpen className='size-3 text-muted-foreground' />}
        primaryText='Documentation'
        secondaryText={<span className='text-xs text-muted-foreground'>{articles.length}</span>}
        hasFooter={false}>
        <div className='space-y-1'>
          {articles.map((article) => (
            <a
              key={article.url}
              href={article.url}
              target='_blank'
              rel='noopener noreferrer'
              className='group flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted'>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-1.5 text-sm font-medium'>
                  <span className='truncate'>{article.title}</span>
                  <ExternalLink className='size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100' />
                </div>
                {article.description && (
                  <p className='line-clamp-1 text-xs text-muted-foreground'>
                    {article.description}
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>
      </BlockCard>
    </div>
  )
}
