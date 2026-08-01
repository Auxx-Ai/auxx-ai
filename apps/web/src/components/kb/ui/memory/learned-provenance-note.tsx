// apps/web/src/components/kb/ui/memory/learned-provenance-note.tsx
'use client'

import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { threadHref } from '~/components/kbar/thread-href'
import { api } from '~/trpc/react'

/** Conversations listed inline before the rest collapse into a count. */
const VISIBLE_SOURCES = 3

/**
 * "Learned from N conversations" strip above a memory article, linking the
 * threads the extractor cited. Renders nothing for an article a human wrote
 * by hand (no provenance) — which is itself the useful signal that the AI did
 * not put it there.
 */
export function LearnedProvenanceNote({ articleId }: { articleId: string }) {
  const { data: sources } = api.kb.learnedProvenance.useQuery({ articleId }, { staleTime: 60_000 })
  if (!sources || sources.length === 0) return null

  const visible = sources.slice(0, VISIBLE_SOURCES)
  const remaining = sources.length - visible.length

  return (
    <div className='flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-8 py-2 text-xs text-muted-foreground'>
      <Sparkles className='size-3.5 shrink-0' />
      <span>
        Learned from {sources.length} conversation{sources.length === 1 ? '' : 's'}:
      </span>
      {visible.map((source) => (
        <Link
          key={source.threadId}
          href={threadHref({ id: source.threadId })}
          className='max-w-[16rem] truncate underline-offset-2 hover:text-foreground hover:underline'>
          {source.subject?.trim() || 'Untitled conversation'}
        </Link>
      ))}
      {remaining > 0 && <span>+{remaining} more</span>}
    </div>
  )
}
