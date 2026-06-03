// apps/web/src/components/kb/ui/sources/source-content-list.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Book, FileText, FolderClosed, Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import type { KnowledgeSource } from './sources-provider'

/**
 * Right pane of the source workspace: an index of the source's managed articles — a
 * thin list over the KB tree subtree, each row deep-linking into the existing editor
 * (read-only). Content lives in the tree, not in a bespoke table. AI-only sources have
 * no tree articles, so they show a note.
 */
export function SourceContentList({ source }: { source: KnowledgeSource }) {
  const router = useRouter()
  const articlesQuery = api.kb.getArticles.useQuery(
    { knowledgeBaseId: source.ownedKnowledgeBaseId },
    { enabled: source.surface !== 'ai-only' }
  )
  const managedArticles = (articlesQuery.data ?? []).filter((a) => a.sourceId === source.id)

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <Tabs value='content'>
        <TabsList className='w-full justify-start rounded-b-none border-b bg-primary-150'>
          <TabsTrigger value='content' variant='outline'>
            <Book />
            Content
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ScrollArea className='flex min-h-0 flex-1 flex-col'>
        <div className='p-4'>
          {source.surface === 'ai-only' ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>
              This source embeds content into the dataset without tree articles.
            </p>
          ) : articlesQuery.isLoading ? (
            <Skeleton className='h-40 w-full rounded-xl' />
          ) : managedArticles.length === 0 ? (
            <p className='py-10 text-center text-sm text-muted-foreground'>
              No articles yet. Run a sync to ingest content.
            </p>
          ) : (
            <div className='flex flex-col divide-y rounded-xl border'>
              {managedArticles.map((article) => {
                const Icon = article.articleKind === 'category' ? FolderClosed : FileText
                return (
                  <button
                    key={article.id}
                    type='button'
                    onClick={() =>
                      router.push(`/app/kb/${article.knowledgeBaseId}/editor/${article.slug}`)
                    }
                    className='flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50'>
                    <Icon className='size-4 shrink-0 text-muted-foreground' />
                    <span className='flex-1 truncate'>{article.title || 'Untitled'}</span>
                    {article.managed && (
                      <Lock className='size-3.5 shrink-0 text-muted-foreground' />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
