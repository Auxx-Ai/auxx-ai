// apps/web/src/components/data-connectors/ui/connector-detail-view.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { toastError } from '@auxx/ui/components/toast'
import { ChevronDown, Pause, Play, RefreshCw, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { useConfirm } from '~/hooks/use-confirm'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { ConnectorDetailTabs } from './connector-detail-tabs'
import { ConnectorRunsPanel } from './connector-runs-panel'
import { asConnectorStatus, ConnectorStatusPill } from './connector-status'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

interface ConnectorDetailViewProps {
  connector: Connector
}

function iconIdForType(type: string): string {
  if (type.startsWith('app:')) return `brand:${type.slice('app:'.length)}`
  return 'plug'
}

/**
 * Connector detail view — the single page that serves both first-time setup and
 * ongoing editing, modeled on `agent-detail-view`. Page shell + status pill +
 * header actions (Sync now / Pause·Resume / Delete with keep·archive·delete), a
 * docked right Runs panel (desktop) / tab (mobile), and the Connection / Streams
 * / Schedule body. See plans/data-connectors/claude/05-frontend.md §2.
 */
export function ConnectorDetailView({ connector }: ConnectorDetailViewProps) {
  const router = useRouter()
  const isDesktop = useMedia('(min-width: 1024px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const status = asConnectorStatus(connector.status)
  const isSyncing = status === 'syncing' || status === 'provisioning'
  const isPaused = status === 'paused'

  const invalidate = () => {
    void utils.dataConnector.getById.invalidate({ id: connector.id })
    void utils.dataConnector.getStatus.invalidate({ id: connector.id })
    void utils.dataConnector.list.invalidate()
  }
  const onError = (verb: string) => (e: { message: string }) =>
    toastError({ title: `Could not ${verb} connector`, description: e.message })

  const syncNow = api.dataConnector.syncNow.useMutation({
    onSuccess: invalidate,
    onError: onError('sync'),
  })
  const pause = api.dataConnector.pause.useMutation({
    onSuccess: invalidate,
    onError: onError('pause'),
  })
  const resume = api.dataConnector.resume.useMutation({
    onSuccess: invalidate,
    onError: onError('resume'),
  })
  const deleteConnector = api.dataConnector.delete.useMutation({
    onSuccess: () => {
      void utils.dataConnector.list.invalidate()
      router.push('/app/connectors')
    },
    onError: onError('delete'),
  })

  const handleDelete = async (syncedData: 'keep' | 'archive' | 'delete') => {
    const copy = {
      keep: 'Synced records are kept; only the connector is removed.',
      archive: 'Synced records are archived and the connector is removed.',
      delete: 'Synced records and the connector are permanently deleted.',
    }[syncedData]
    const ok = await confirm({
      title: 'Delete connector?',
      description: `${copy} This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) deleteConnector.mutate({ id: connector.id, syncedData })
  }

  const runsPanel = <ConnectorRunsPanel connectorId={connector.id} initialStatus={status} />

  return (
    <MainPage>
      <ConfirmDialog />
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              loading={syncNow.isPending}
              loadingText='Syncing...'
              disabled={isSyncing}
              onClick={() => syncNow.mutate({ id: connector.id })}>
              <RefreshCw />
              Sync now
            </Button>
            {isPaused ? (
              <Button
                variant='outline'
                size='sm'
                loading={resume.isPending}
                onClick={() => resume.mutate({ id: connector.id })}>
                <Play />
                Resume
              </Button>
            ) : (
              <Button
                variant='outline'
                size='sm'
                loading={pause.isPending}
                onClick={() => pause.mutate({ id: connector.id })}>
                <Pause />
                Pause
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='destructive' size='sm' loading={deleteConnector.isPending}>
                  <Trash />
                  Delete
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => void handleDelete('keep')}>
                  Delete, keep synced records
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleDelete('archive')}>
                  Delete, archive synced records
                </DropdownMenuItem>
                <DropdownMenuItem variant='destructive' onClick={() => void handleDelete('delete')}>
                  Delete connector and synced records
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
          <MainPageBreadcrumbItem
            title={connector.name}
            icon={
              <AppIcon iconId={iconIdForType(connector.type)} fallbackIconId='plug' size='xs' />
            }
            last
          />
          <ConnectorStatusPill status={status} className='ml-2' />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent
        dockedPanels={
          isDesktop
            ? [
                {
                  key: 'connector-runs',
                  content: runsPanel,
                  width: dockedWidth,
                  onWidthChange: setDockedWidth,
                  minWidth,
                  maxWidth,
                },
              ]
            : []
        }>
        <ConnectorDetailTabs
          connector={connector}
          mobileRunsPanel={!isDesktop ? runsPanel : null}
        />
      </MainPageContent>
    </MainPage>
  )
}
