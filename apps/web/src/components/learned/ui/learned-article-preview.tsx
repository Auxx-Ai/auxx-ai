// apps/web/src/components/learned/ui/learned-article-preview.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '~/trpc/react'
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
 * Preview of a proposed AI-memory write: title + category + description, then
 * the body.
 *
 * For a NEW article the body is the rendered proposal. For an UPDATE it is a
 * line diff against the published article, because the tool replaces the whole
 * body — the failure worth catching is a merge that quietly drops a line a
 * human wrote, and a rendered proposal looks identical whether it kept that
 * line or not.
 */
export function LearnedArticlePreview({
  args,
  className,
}: {
  args: Record<string, unknown>
  className?: string
}) {
  const { articleId, category, title, description, markdown } = args as LearnedArticleArgs
  const categoryLabel = category ? (CATEGORY_LABELS[category] ?? category) : undefined

  // Updates only — a create has nothing to diff against. `temp_<n>` ids belong
  // to articles this same bundle is about to create, so they aren't real yet.
  const isUpdate = !!articleId && !articleId.startsWith('temp_') && !!markdown
  const { data: diff } = api.kb.learnedArticleDiff.useQuery(
    { articleId: articleId ?? '', markdown: markdown ?? '' },
    { enabled: isUpdate, staleTime: 60_000 }
  )
  const showDiff = isUpdate && diff?.found && diff.lines.length > 0

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
          {isUpdate && (
            <span className='rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground'>
              Update
            </span>
          )}
        </div>
        {description && <p className='text-xs text-muted-foreground'>{description}</p>}
      </div>

      {showDiff && diff ? (
        <div className='space-y-1 border-t pt-2'>
          <p className='text-[11px] text-muted-foreground'>
            {diff.removedCount > 0
              ? `${diff.addedCount} line${diff.addedCount === 1 ? '' : 's'} added, ${diff.removedCount} removed`
              : `${diff.addedCount} line${diff.addedCount === 1 ? '' : 's'} added`}
          </p>
          <div className='max-h-64 overflow-y-auto rounded-lg bg-muted/40 p-2 font-mono text-[11px] leading-relaxed'>
            {diff.lines.map((line, index) => (
              <div
                // Diff lines have no stable identity; index is the position.
                key={`${line.type}-${index}`}
                className={cn(
                  'whitespace-pre-wrap',
                  line.type === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                  line.type === 'remove' && 'bg-red-500/10 text-red-700 dark:text-red-400',
                  line.type === 'same' && 'text-muted-foreground'
                )}>
                {line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  '}
                {line.text}
              </div>
            ))}
          </div>
        </div>
      ) : (
        markdown && (
          <div className='kopilot-prose max-h-64 overflow-y-auto border-t pt-2'>
            <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
          </div>
        )
      )}
    </div>
  )
}
