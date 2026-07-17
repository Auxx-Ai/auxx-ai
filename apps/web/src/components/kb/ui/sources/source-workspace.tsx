// apps/web/src/components/kb/ui/sources/source-workspace.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { toastError } from '@auxx/ui/components/toast'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { LoadingSpinner } from '~/components/global/loading-content'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { KnowledgeBaseProvider } from '../../providers/knowledge-base-provider'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleEditorSurfaceProvider } from '../editor/article-editor-surface'
import { KBPreviewHintProvider } from '../preview/preview-hint-context'
import { SourceArticleView } from './source-article-view'
import { SourceSettingsPanel } from './source-settings-panel'
import type { SourceStatus } from './sources-provider'

/** Keep article nav inside the source workspace (stable ref so the surface memo holds). */
const buildSourceArticleHref = (a: ArticleMeta) => `?panel=articles&article=${a.id}`

const STATUS_PILL: Record<SourceStatus, { label: string; className: string }> = {
  live: { label: 'Live', className: 'bg-good-500/15 text-good-600' },
  syncing: { label: 'Syncing', className: 'bg-warning-500/15 text-warning-600' },
  error: { label: 'Error', className: 'bg-destructive/15 text-destructive' },
  paused: { label: 'Paused', className: 'bg-muted text-muted-foreground' },
  pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
}

/**
 * Source workspace (`/app/kb/sources/[id]`) — two-pane, like the KB editor: a left
 * settings panel (General; the wizard questions, editable) and the article content
 * on the right. A source *syncs* rather than *publishes*, so the header action is
 * Sync now + delete, not a publish cluster.
 */
export function SourceWorkspace({ sourceId }: { sourceId: string }) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const sourceQuery = api.knowledgeSource.getById.useQuery(
    { id: sourceId },
    { refetchInterval: (query) => (query.state.data?.status === 'syncing' ? 4000 : false) }
  )
  const source = sourceQuery.data

  const syncNow = api.knowledgeSource.syncNow.useMutation({
    onSettled: () => void utils.knowledgeSource.getById.invalidate({ id: sourceId }),
    onError: (e) => toastError({ title: 'Could not sync source', description: e.message }),
  })
  const deleteSource = api.knowledgeSource.delete.useMutation({
    onSuccess: () => router.push('/app/kb?t=sources'),
    onError: (e) => toastError({ title: 'Could not delete source', description: e.message }),
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete source?',
      description:
        'This removes the source and all of its content, including any links into other knowledge bases. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    })
    if (ok) deleteSource.mutate({ id: sourceId })
  }

  const leftPanels = useMemo(() => {
    if (!source) return []
    return [
      {
        key: 'source-settings',
        content: <SourceSettingsPanel source={source} />,
        width: 480,
      },
    ]
  }, [source])

  const status = source ? (STATUS_PILL[source.status] ?? STATUS_PILL.pending) : null
  const isSyncing = source?.status === 'syncing'

  return (
    <MainPage>
      <ConfirmDialog />
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {status && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}>
                {status.label}
              </span>
            )}
            <Button
              variant='outline'
              size='sm'
              loading={syncNow.isPending}
              loadingText='Queuing...'
              disabled={isSyncing || !source}
              onClick={() => syncNow.mutate({ id: sourceId })}>
              <RefreshCw />
              Sync now
            </Button>
            <Button variant='ghost' size='icon-sm' onClick={handleDelete} disabled={!source}>
              <Trash2 />
            </Button>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Knowledge Bases'
            href='/app/kb'
            className='hidden sm:inline-flex'
          />
          <MainPageBreadcrumbItem title='Sources' href='/app/kb?t=sources' />
          <MainPageBreadcrumbItem title={source?.name ?? 'Source'} />
        </MainPageBreadcrumb>
      </MainPageHeader>

      {source ? (
        <KnowledgeBaseProvider knowledgeBaseId={source.ownedKnowledgeBaseId}>
          <KBPreviewHintProvider>
            <ArticleEditorSurfaceProvider buildHref={buildSourceArticleHref} hidePublishing>
              <MainPageContent leftPanels={leftPanels}>
                <SourceArticleView source={source} />
              </MainPageContent>
            </ArticleEditorSurfaceProvider>
          </KBPreviewHintProvider>
        </KnowledgeBaseProvider>
      ) : (
        <MainPageContent leftPanels={leftPanels}>
          <LoadingSpinner />
        </MainPageContent>
      )}
    </MainPage>
  )
}
