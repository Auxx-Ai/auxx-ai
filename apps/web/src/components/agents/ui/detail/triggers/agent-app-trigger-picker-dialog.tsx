// apps/web/src/components/agents/ui/detail/triggers/agent-app-trigger-picker-dialog.tsx
'use client'

import type { CatalogTriggerProjection } from '@auxx/database'
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
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { pluralize } from '@auxx/utils/strings'
import { ChevronLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type AppInstallation,
  useExtensionsContext,
} from '~/providers/extensions/extensions-context'
import { ToolSelectRow } from '../tools/tool-select-row'

export interface AppTriggerSelection {
  installation: AppInstallation
  trigger: CatalogTriggerProjection
}

interface AgentAppTriggerPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (selection: AppTriggerSelection) => void
}

type ViewMode = 'list' | 'app-detail'
type ListTab = 'all' | 'apps'

/**
 * Picker dialog for selecting an (app, trigger) pair from installed apps that
 * expose `agentTriggers` in their catalog. Mirrors the toolset picker shell —
 * tabs for All / Apps, plus an App-detail view. On select, fires `onSelect`
 * with the installation + trigger projection so the parent can open the
 * agent-trigger config dialog pre-filled.
 */
export function AgentAppTriggerPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: AgentAppTriggerPickerDialogProps) {
  const { appInstallations, isLoading } = useExtensionsContext()

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [tab, setTab] = useState<ListTab>('all')
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setViewMode('list')
      setTab('all')
      setSelectedAppId(null)
      setSearch('')
    }
  }, [open])

  const appsWithTriggers = useMemo(
    () => appInstallations.filter((i) => (i.agentTriggers?.length ?? 0) > 0),
    [appInstallations]
  )

  const flat = useMemo(() => {
    const out: Array<{ installation: AppInstallation; trigger: CatalogTriggerProjection }> = []
    for (const inst of appsWithTriggers) {
      for (const trigger of inst.agentTriggers ?? []) {
        out.push({ installation: inst, trigger })
      }
    }
    return out
  }, [appsWithTriggers])

  const filteredFlat = useMemo(() => {
    if (!search.trim()) return flat
    const q = search.trim().toLowerCase()
    return flat.filter(
      (e) =>
        e.trigger.label.toLowerCase().includes(q) ||
        (e.trigger.description ?? '').toLowerCase().includes(q) ||
        e.installation.app.title.toLowerCase().includes(q)
    )
  }, [flat, search])

  const filteredApps = useMemo(() => {
    if (!search.trim()) return appsWithTriggers
    const q = search.trim().toLowerCase()
    return appsWithTriggers.filter((i) => i.app.title.toLowerCase().includes(q))
  }, [appsWithTriggers, search])

  const selectedApp = useMemo(
    () => (selectedAppId ? appsWithTriggers.find((i) => i.app.id === selectedAppId) : null),
    [appsWithTriggers, selectedAppId]
  )

  const handleOpenApp = (installation: AppInstallation) => {
    setSelectedAppId(installation.app.id)
    setViewMode('app-detail')
    setSearch('')
  }

  const handleBack = () => {
    setViewMode('list')
    setTab('apps')
    setSelectedAppId(null)
    setSearch('')
  }

  const handlePick = (installation: AppInstallation, trigger: CatalogTriggerProjection) => {
    onSelect({ installation, trigger })
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
                    Add app trigger
                  </Button>
                  <DialogTitle className='sr-only'>Add app trigger</DialogTitle>
                  <DialogDescription className='sr-only'>
                    Pick a trigger from one of your installed apps to fire this agent.
                  </DialogDescription>
                </div>
              </DialogHeader>

              <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
                <Tabs value={tab} onValueChange={(v) => setTab(v as ListTab)}>
                  <TabsList>
                    <TabsTrigger value='all'>All</TabsTrigger>
                    <TabsTrigger value='apps'>Apps</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className='flex-1 max-w-xs'>
                  <InputSearch
                    ref={searchInputRef}
                    placeholder='Search triggers...'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClear={() => setSearch('')}
                  />
                </div>
              </div>

              <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
                <div className='py-3 px-3'>
                  {isLoading ? (
                    <div className='py-12 text-center text-sm text-muted-foreground'>Loading…</div>
                  ) : tab === 'all' ? (
                    filteredFlat.length === 0 ? (
                      <EmptyResult search={search} />
                    ) : (
                      <div className='space-y-1'>
                        {filteredFlat.map((entry) => (
                          <ToolSelectRow
                            key={`${entry.installation.installationId}:${entry.trigger.triggerId}`}
                            id={`${entry.installation.installationId}:${entry.trigger.triggerId}`}
                            iconId={entry.installation.app.avatarUrl ?? 'package'}
                            color={null}
                            label={entry.trigger.label}
                            description={entry.trigger.description}
                            subtitle={entry.installation.app.title}
                            installed={false}
                            onSelect={() => handlePick(entry.installation, entry.trigger)}
                          />
                        ))}
                      </div>
                    )
                  ) : filteredApps.length === 0 ? (
                    <EmptyResult search={search} />
                  ) : (
                    <div className='space-y-1'>
                      {filteredApps.map((inst) => {
                        const triggerCount = inst.agentTriggers?.length ?? 0
                        return (
                          <ToolSelectRow
                            key={inst.installationId}
                            id={inst.installationId}
                            iconId={inst.app.avatarUrl ?? 'package'}
                            color={null}
                            label={inst.app.title}
                            subtitle={`${triggerCount} ${pluralize(triggerCount, 'trigger')}`}
                            installed={false}
                            onSelect={() => handleOpenApp(inst)}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : selectedApp ? (
            <>
              <DialogHeader className='mb-0 flex h-10 flex-row items-center border-b px-3'>
                <div className='flex items-center gap-1'>
                  <Button variant='ghost' size='sm' onClick={handleBack}>
                    <ChevronLeft />
                    Back
                  </Button>
                  <Separator orientation='vertical' className='h-5' />
                  <Button variant='ghost' size='sm'>
                    {selectedApp.app.title}
                  </Button>
                  <DialogTitle className='sr-only'>{selectedApp.app.title}</DialogTitle>
                  <DialogDescription className='sr-only'>
                    Triggers exposed by {selectedApp.app.title}.
                  </DialogDescription>
                </div>
              </DialogHeader>

              <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
                <div className='p-3 space-y-1'>
                  {(selectedApp.agentTriggers ?? []).map((trigger) => (
                    <ToolSelectRow
                      key={trigger.triggerId}
                      id={trigger.triggerId}
                      iconId={selectedApp.app.avatarUrl ?? 'package'}
                      color={null}
                      label={trigger.label}
                      description={trigger.description}
                      installed={false}
                      onSelect={() => handlePick(selectedApp, trigger)}
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
          ? `No triggers match "${search}".`
          : 'No installed apps expose agent triggers yet.'}
      </p>
    </div>
  )
}
