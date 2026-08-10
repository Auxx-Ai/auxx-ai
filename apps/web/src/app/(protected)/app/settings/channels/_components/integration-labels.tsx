'use client'
// ~/app/(protected)/app/settings/channels/_components/integration-labels.tsx

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
import { TreeRow, TreeRowEmpty } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Edit, Folder, FolderSync, RefreshCw, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { api } from '~/trpc/react'

interface IntegrationLabelsProps {
  integration: { id: string; provider: string }
  /** Viewer may not manage this channel (member on a shared channel) — render read-only. */
  disabled?: boolean
}

export default function IntegrationLabels({ integration, disabled }: IntegrationLabelsProps) {
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
    <SettingsSection
      icon={FolderSync}
      title='Synced Folders'
      description='Choose which folders to sync messages from.'>
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
          <Button
            variant='outline'
            size='sm'
            disabled={disabled}
            onClick={() => setDialogOpen(true)}>
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
                <div className='rounded-xl border p-1 max-h-80 overflow-y-auto'>
                  {filteredLabels.length === 0 ? (
                    <TreeRowEmpty
                      icon={<SearchX className='size-4' />}
                      title='No folders match your search.'
                    />
                  ) : (
                    <TreeRowList
                      className='gap-1'
                      items={filteredLabels}
                      getKey={(label) => label.id}
                      renderRow={(label) => {
                        const isPendingRemoval = label.pendingAction === 'PENDING_REMOVAL'
                        // Only the row being toggled locks — the write is optimistic, so
                        // the other rows stay usable while it's in flight.
                        const isToggling =
                          toggleEnabled.isPending && toggleEnabled.variables?.labelId === label.id
                        const rowDisabled = isPendingRemoval || isToggling
                        return (
                          <TreeRow
                            rowClassName={`bg-primary-50 hover:bg-primary-100 ${isPendingRemoval ? 'opacity-50' : ''}`}
                            icon={<Folder className='size-4' />}
                            title={label.name}
                            secondary={isPendingRemoval ? 'Removed from server' : undefined}
                            onToggleOpen={
                              rowDisabled
                                ? undefined
                                : () =>
                                    toggleEnabled.mutate({
                                      labelId: label.id,
                                      enabled: !label.enabled,
                                    })
                            }
                            actions={
                              <Switch
                                size='xs'
                                checked={label.enabled}
                                disabled={rowDisabled}
                                onCheckedChange={(enabled) =>
                                  toggleEnabled.mutate({ labelId: label.id, enabled })
                                }
                              />
                            }
                          />
                        )
                      }}
                    />
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
    </SettingsSection>
  )
}
