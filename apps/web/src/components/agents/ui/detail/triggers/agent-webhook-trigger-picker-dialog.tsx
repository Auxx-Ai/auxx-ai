// apps/web/src/components/agents/ui/detail/triggers/agent-webhook-trigger-picker-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { pluralize } from '@auxx/utils/strings'
import { ChevronLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { ToolSelectRow } from '../tools/tool-select-row'

/** A picked (connection, topic) pair the parent uses to open the config dialog. */
export interface WebhookTriggerSelection {
  connectionId: string
  connectionName: string
  connectionType: string
  icon: string | null
  topic: string
}

type WebhookConnection = {
  id: string
  name: string
  type: string
  icon: string | null
  topics: string[]
}

interface AgentWebhookTriggerPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (selection: WebhookTriggerSelection) => void
}

type ViewMode = 'list' | 'connection-detail'

/**
 * Picker dialog for selecting a (connection, topic) pair from org connections
 * whose provider has a `WebhookSpec`. Mirrors the app-trigger picker shell — a
 * connection list, then a topic-detail view. On select, fires `onSelect` with the
 * connection + topic so the parent can open the agent-trigger config dialog
 * pre-filled. Source list comes from `connections.webhookConnections` (already
 * filtered to spec-bearing providers, so we never offer a connection that can't
 * carry a webhook trigger).
 */
export function AgentWebhookTriggerPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: AgentWebhookTriggerPickerDialogProps) {
  const connectionsQuery = api.connections.webhookConnections.useQuery(undefined, { enabled: open })
  const connections: WebhookConnection[] = connectionsQuery.data ?? []
  const isLoading = connectionsQuery.isLoading

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setViewMode('list')
      setSelectedConnectionId(null)
      setSearch('')
    }
  }, [open])

  const filteredConnections = useMemo(() => {
    if (!search.trim()) return connections
    const q = search.trim().toLowerCase()
    return connections.filter(
      (c) => c.name.toLowerCase().includes(q) || c.topics.some((t) => t.toLowerCase().includes(q))
    )
  }, [connections, search])

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  )

  const filteredTopics = useMemo(() => {
    if (!selectedConnection) return []
    if (!search.trim()) return selectedConnection.topics
    const q = search.trim().toLowerCase()
    return selectedConnection.topics.filter((t) => t.toLowerCase().includes(q))
  }, [selectedConnection, search])

  const handleOpenConnection = (connection: WebhookConnection) => {
    setSelectedConnectionId(connection.id)
    setViewMode('connection-detail')
    setSearch('')
  }

  const handleBack = () => {
    setViewMode('list')
    setSelectedConnectionId(null)
    setSearch('')
  }

  const handlePick = (connection: WebhookConnection, topic: string) => {
    onSelect({
      connectionId: connection.id,
      connectionName: connection.name,
      connectionType: connection.type,
      icon: connection.icon,
      topic,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='h-dvh sm:h-[600px]'
        innerClassName='p-0'
        position='tc'
        size='lg'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        }}>
        <div className='flex flex-1 flex-col min-h-0'>
          {viewMode === 'list' ? (
            <>
              <DialogHeader className='mb-0 flex h-10 flex-row items-center justify-between border-b px-3'>
                <div>
                  <Button variant='ghost' size='sm'>
                    Add webhook trigger
                  </Button>
                  <DialogTitle className='sr-only'>Add webhook trigger</DialogTitle>
                  <DialogDescription className='sr-only'>
                    Pick a connection and topic to fire this agent on incoming webhooks.
                  </DialogDescription>
                </div>
                <div className='flex-1 max-w-xs'>
                  <InputSearch
                    ref={searchInputRef}
                    placeholder='Search connections...'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClear={() => setSearch('')}
                  />
                </div>
              </DialogHeader>

              <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
                <div className='py-3 px-3'>
                  {isLoading ? (
                    <div className='py-12 text-center text-sm text-muted-foreground'>Loading…</div>
                  ) : filteredConnections.length === 0 ? (
                    <EmptyResult search={search} />
                  ) : (
                    <div className='space-y-1'>
                      {filteredConnections.map((connection) => {
                        const topicCount = connection.topics.length
                        return (
                          <ToolSelectRow
                            key={connection.id}
                            id={connection.id}
                            iconId={connection.icon ?? 'plug'}
                            color={null}
                            label={connection.name}
                            subtitle={`${topicCount} ${pluralize(topicCount, 'topic')}`}
                            installed={false}
                            onSelect={() => handleOpenConnection(connection)}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : selectedConnection ? (
            <>
              <DialogHeader className='mb-0 flex h-10 flex-row items-center border-b px-3'>
                <div className='flex items-center gap-1'>
                  <Button variant='ghost' size='sm' onClick={handleBack}>
                    <ChevronLeft />
                    Back
                  </Button>
                  <Separator orientation='vertical' className='h-5' />
                  <Button variant='ghost' size='sm'>
                    {selectedConnection.name}
                  </Button>
                  <DialogTitle className='sr-only'>{selectedConnection.name}</DialogTitle>
                  <DialogDescription className='sr-only'>
                    Topics exposed by {selectedConnection.name}.
                  </DialogDescription>
                </div>
              </DialogHeader>

              <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
                <div className='p-3 space-y-1'>
                  {filteredTopics.map((topic) => (
                    <ToolSelectRow
                      key={topic}
                      id={topic}
                      iconId={selectedConnection.icon ?? 'plug'}
                      color={null}
                      label={topic}
                      installed={false}
                      onSelect={() => handlePick(selectedConnection, topic)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmptyResult({ search }: { search: string }) {
  return (
    <div className='flex flex-col items-center justify-center py-12 text-center'>
      <p className='text-sm text-muted-foreground'>
        {search.trim()
          ? `No connections match "${search}".`
          : 'No connections support webhook triggers yet.'}
      </p>
    </div>
  )
}
