// apps/web/src/components/learned/ui/learned-article-preview.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import '~/components/kopilot/styles/kopilot-prose.css'

/** Args of a proposed `upsert_learned_article` call, as captured by the engine. */
export interface LearnedArticleArgs {
  articleId?: string
  category?: string
  title?: string
  description?: string
  markdown?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  policies: 'Policies',
  companies: 'Companies',
  contacts: 'Contacts',
}

/**
 * Light preview of a proposed AI-memory write: title + category + description
 * plus the full proposed article markdown, rendered. Shared by the Today
 * bundle card and the in-chat kopilot approval card — the reviewer sees what
 * will be published (not a diff against the current article).
 */
export function LearnedArticlePreview({
  args,
  className,
}: {
  args: Record<string, unknown>
  className?: string
}) {
  const { category, title, description, markdown } = args as LearnedArticleArgs
  const categoryLabel = category ? (CATEGORY_LABELS[category] ?? category) : undefined

  return (
    <div className={cn('space-y-2 rounded-xl bg-background/60 p-3', className)}>
      <div className='space-y-0.5'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium text-foreground'>{title ?? 'Untitled memory'}</span>
          {categoryLabel && (
            <span className='rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground'>
              {categoryLabel}
            </span>
          )}
        </div>
        {description && <p className='text-xs text-muted-foreground'>{description}</p>}
      </div>
      {markdown && (
        <div className='kopilot-prose max-h-64 overflow-y-auto border-t pt-2'>
          <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
        </div>
      )}
    </div>
  )
}
