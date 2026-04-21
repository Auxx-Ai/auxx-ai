// apps/web/src/components/kopilot/ui/blocks/kb-article-list-block.tsx

import { FileText } from 'lucide-react'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { KBArticleListData } from './block-schemas'

export function KBArticleListBlock({ data }: BlockRendererProps<KBArticleListData>) {
  const { articles } = data
  if (articles.length === 0) return null

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='kb-article-list-block'
        indicator={<FileText className='size-3 text-muted-foreground' />}
        primaryText='Knowledge base'
        secondaryText={<span className='text-xs text-muted-foreground'>{articles.length}</span>}
        hasFooter={false}>
        <div className='space-y-1'>
          {articles.map((article) => {
            const content = (
              <>
                <div className='truncate text-sm font-medium'>{article.title}</div>
                {article.excerpt && (
                  <p className='line-clamp-2 text-xs text-muted-foreground'>{article.excerpt}</p>
                )}
                {article.datasetName && (
                  <p className='mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'>
                    {article.datasetName}
                  </p>
                )}
              </>
            )

            return article.url ? (
              <a
                key={article.id}
                href={article.url}
                target='_blank'
                rel='noopener noreferrer'
                className='block rounded-md px-1.5 py-1 transition-colors hover:bg-muted'>
                {content}
              </a>
            ) : (
              <div key={article.id} className='rounded-md px-1.5 py-1'>
                {content}
              </div>
            )
          })}
        </div>
      </BlockCard>
    </div>
  )
}
