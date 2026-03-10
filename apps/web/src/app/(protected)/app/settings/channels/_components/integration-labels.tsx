'use client'
// ~/app/(protected)/app/settings/integrations/_components/integration-labels.tsx

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Kbd } from '@auxx/ui/components/kbd'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { Edit, FolderSync, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'

interface IntegrationLabelsProps {
  integration: { id: string; provider: string }
}

export default function IntegrationLabels({ integration }: IntegrationLabelsProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const utils = api.useUtils()

  const { data, isLoading } = api.label.getIntegrationLabels.useQuery({
    integrationId: integration.id,
  })

  const toggleEnabled = api.label.toggleLabelEnabled.useMutation({
    onMutate: async ({ labelId, enabled }) => {
      await utils.label.getIntegrationLabels.cancel({ integrationId: integration.id })
      const prev = utils.label.getIntegrationLabels.getData({ integrationId: integration.id })
      utils.label.getIntegrationLabels.setData({ integrationId: integration.id }, (old) => {
        if (!old) return old
        return {
          labels: old.labels.map((l) => (l.id === labelId ? { ...l, enabled } : l)),
        }
      })
      return { prev }
    },
    onError: (error, _vars, context) => {
      if (context?.prev) {
        utils.label.getIntegrationLabels.setData({ integrationId: integration.id }, context.prev)
      }
      toastError({ title: 'Error toggling folder', description: error.message })
    },
  })

  const discoverFolders = api.label.discoverFolders.useMutation({
    onSuccess: () => {
      utils.label.getIntegrationLabels.invalidate({ integrationId: integration.id })
    },
    onError: (error) => {
      toastError({ title: 'Error discovering folders', description: error.message })
    },
  })

  const labels = data?.labels ?? []
  const enabledCount = labels.filter((l) => l.enabled).length
  const filteredLabels = useMemo(() => {
    if (!search.trim()) return labels
    const term = search.toLowerCase()
    return labels.filter((l) => l.name.toLowerCase().includes(term))
  }, [labels, search])

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
          <FolderSync className='size-4' /> Synced Folders
        </div>
        <p className='text-sm text-muted-foreground'>Choose which folders to sync messages from.</p>
      </div>

      <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
        <div className='flex items-center gap-3'>
          <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0'>
            <FolderSync className='size-4' />
          </div>
          <div className='flex flex-col'>
            {isLoading ? (
              <Skeleton className='h-3 w-24' />
            ) : (
              <span className='text-sm font-medium'>
                {enabledCount} of {labels.length} folders synced
              </span>
            )}
            <span className='text-xs text-muted-foreground'>
              Only enabled folders will be synced
            </span>
          </div>
        </div>
        {isLoading ? (
          <Skeleton className='h-7 w-28' />
        ) : (
          <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
            <Edit />
            Edit folders
          </Button>
        )}
      </div>

      {dialogOpen ? (
        <Dialog
          open
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) setSearch('')
          }}>
          <DialogContent size='sm'>
            <DialogHeader className='mb-4'>
              <DialogTitle>Synced Folders</DialogTitle>
              <DialogDescription>
                Toggle folders on or off to control which ones are synced.
              </DialogDescription>
            </DialogHeader>

            {labels.length === 0 ? (
              <div className='text-sm text-muted-foreground py-4'>
                No folders discovered yet. Click Refresh to discover folders from the server.
              </div>
            ) : (
              <div className='space-y-2'>
                <InputSearch
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder='Search folders...'
                />
                <div className='rounded-2xl border divide-y max-h-80 overflow-y-auto'>
                  {filteredLabels.length === 0 ? (
                    <div className='px-3 py-4 text-sm text-muted-foreground text-center'>
                      No folders match your search.
                    </div>
                  ) : (
                    filteredLabels.map((label) => {
                      const isPendingRemoval = label.pendingAction === 'PENDING_REMOVAL'
                      return (
                        <div
                          key={label.id}
                          className={`flex items-center justify-between px-3 py-2.5 ${isPendingRemoval ? 'opacity-50' : ''}`}>
                          <div className='flex flex-col'>
                            <span className='text-sm font-medium'>{label.name}</span>
                            {isPendingRemoval && (
                              <span className='text-xs text-muted-foreground'>
                                Removed from server
                              </span>
                            )}
                          </div>
                          <Switch
                            size='sm'
                            checked={label.enabled}
                            disabled={isPendingRemoval || toggleEnabled.isPending}
                            onCheckedChange={(enabled) =>
                              toggleEnabled.mutate({ labelId: label.id, enabled })
                            }
                          />
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                variant='outline'
                size='sm'
                onClick={() => discoverFolders.mutate({ integrationId: integration.id })}
                loading={discoverFolders.isPending}
                loadingText='Refreshing...'>
                <RefreshCw /> Refresh folders
              </Button>
              <Button variant='ghost' size='sm' onClick={() => setDialogOpen(false)}>
                Done <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
