// apps/web/src/components/kopilot/ui/blocks/kb-article-block.tsx

import { FileText } from 'lucide-react'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { KBArticleData } from './block-schemas'

export function KBArticleBlock({ data }: BlockRendererProps<KBArticleData>) {
  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='kb-article-block'
        indicator={<FileText className='size-3 text-muted-foreground' />}
        primaryText={data.title}
        hasFooter={false}>
        {data.excerpt && (
          <p className='line-clamp-2 text-xs text-muted-foreground'>{data.excerpt}</p>
        )}
      </BlockCard>
    </div>
  )
}
