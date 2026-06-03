// apps/web/src/components/kb/ui/sources/source-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { toastError } from '@auxx/ui/components/toast'
import {
  ClipboardPaste,
  Database,
  FileText,
  Globe,
  MoreVertical,
  Pause,
  Play,
  RefreshCw,
  ShoppingBag,
  Trash,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { KnowledgeSource, SourceStatus } from './sources-provider'

interface SourceCardProps {
  source: KnowledgeSource
  onClick?: () => void
  onActionComplete?: () => void
}

const TYPE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  website: Globe,
  manual: ClipboardPaste,
  file: FileText,
  shopify: ShoppingBag,
}

const STATUS_DOT: Record<SourceStatus, { color: string; label: string }> = {
  live: { color: 'bg-good-500', label: 'Live' },
  syncing: { color: 'bg-warning-500', label: 'Syncing' },
  error: { color: 'bg-destructive', label: 'Error' },
  paused: { color: 'bg-muted-foreground/40', label: 'Paused' },
  pending: { color: 'bg-muted-foreground/40', label: 'Pending' },
}

export function SourceCard({ source, onClick, onActionComplete }: SourceCardProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const onSettled = () => {
    void utils.knowledgeSource.list.invalidate()
    onActionComplete?.()
  }
  const onError = (verb: string) => (e: { message: string }) =>
    toastError({ title: `Could not ${verb} source`, description: e.message })

  const syncNow = api.knowledgeSource.syncNow.useMutation({
    onSettled,
    onError: onError('sync'),
  })
  const pause = api.knowledgeSource.pause.useMutation({ onSettled, onError: onError('pause') })
  const resume = api.knowledgeSource.resume.useMutation({ onSettled, onError: onError('resume') })
  const deleteSource = api.knowledgeSource.delete.useMutation({
    onSettled,
    onError: onError('delete'),
  })

  const Icon = TYPE_ICON[source.type] ?? Database
  const status = STATUS_DOT[source.status] ?? STATUS_DOT.pending
  const isSyncing = source.status === 'syncing'
  const isPaused = source.status === 'paused'

  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const wrap = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    void fn()
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete source?',
      description:
        'This removes the source and all of its content, including any links into other knowledge bases. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    })
    if (ok) deleteSource.mutate({ id: source.id })
  }

  return (
    <>
      <ConfirmDialog />
      <div
        className='rounded-2xl bg-background dark:bg-primary-50 hover:bg-primary-50/50 hover:outline-5 dark:hover:outline-primary-50/50 hover:outline-primary-100 flex flex-col p-3 gap-2 border cursor-pointer group/source-card relative'
        onClick={onClick}>
        <div className='flex flex-row items-start gap-2 w-full'>
          <div className='relative shrink-0'>
            <div className='size-8 rounded-xl border flex items-center justify-center overflow-hidden'>
              <Icon className='size-4' />
            </div>
            <Tooltip content={source.error ?? status.label}>
              <div
                className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-primary-50 ${status.color}`}
              />
            </Tooltip>
          </div>

          <div className='flex flex-col flex-1 min-w-0'>
            <p className='text-sm font-semibold line-clamp-2 group-hover/source-card:text-info'>
              {source.name}
            </p>
            {source.lastSyncedAt ? (
              <LastUpdated
                timestamp={source.lastSyncedAt}
                prefix='Synced '
                className='text-xs text-muted-foreground'
              />
            ) : (
              <span className='text-xs text-muted-foreground'>Never synced</span>
            )}
          </div>
        </div>

        <div className='flex items-center justify-between mt-auto gap-2'>
          <Badge variant='pill' size='sm' className='min-w-0 mt-0.5'>
            <span className='shrink-0'>
              {source.itemCount} article{source.itemCount === 1 ? '' : 's'}
            </span>
          </Badge>
          <div className='flex items-center gap-1 shrink-0'>
            <Badge variant='outline' size='sm' className='shrink-0'>
              {source.surface === 'ai-only' ? 'AI-only' : 'Articles'}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className='opacity-0 group-hover/source-card:opacity-100 duration-300 data-[state=open]:opacity-100! data-[state=open]:bg-muted! transition-opacity rounded-lg'
                  variant='ghost'
                  size='icon-xs'
                  onClick={stop}>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' onClick={stop}>
                <DropdownMenuItem onClick={wrap(() => onClick?.())}>
                  <FileText />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={wrap(() => syncNow.mutate({ id: source.id }))}
                  disabled={isSyncing}>
                  <RefreshCw />
                  Sync now
                </DropdownMenuItem>
                {isPaused ? (
                  <DropdownMenuItem onClick={wrap(() => resume.mutate({ id: source.id }))}>
                    <Play />
                    Resume
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={wrap(() => pause.mutate({ id: source.id }))}>
                    <Pause />
                    Pause
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={wrap(handleDelete)} variant='destructive'>
                  <Trash />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </>
  )
}
