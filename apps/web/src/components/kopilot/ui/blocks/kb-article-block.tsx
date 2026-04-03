// apps/web/src/components/kopilot/ui/blocks/kb-article-block.tsx

import { FileText } from 'lucide-react'
import type { BlockRendererProps } from './block-registry'
import type { KBArticleData } from './block-schemas'

export function KBArticleBlock({ data }: BlockRendererProps<KBArticleData>) {
  return (
    <div className='not-prose my-2 rounded-lg border px-3 py-2.5'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <FileText className='size-3.5 shrink-0 text-muted-foreground' />
        <span className='truncate'>{data.title}</span>
      </div>
      {data.excerpt && (
        <p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>{data.excerpt}</p>
      )}
    </div>
  )
}
