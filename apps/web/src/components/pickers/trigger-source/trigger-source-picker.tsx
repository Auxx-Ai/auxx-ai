// apps/web/src/components/pickers/trigger-source/trigger-source-picker.tsx
// Shared, grouped trigger picker (unified-trigger-picker §2.2). Lists BOTH installed-app
// webhook triggers (APPS) and generic inbound WebhookEndpoints (WEBHOOK ENDPOINTS) in one
// dialog and returns the discriminated `TriggerSource` the caller chose. Used by the agent
// trigger flow and the data-connector webhook-binding section so both stay on one mechanism.

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
import { Webhook } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ToolSelectRow } from '~/components/agents/ui/detail/tools/tool-select-row'
import { type TriggerSource, type TriggerSurface, useTriggerSources } from './use-trigger-sources'

interface TriggerSourcePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (source: TriggerSource) => void
  surface?: TriggerSurface
  /** Restrict the APP group to one app (data-connector binds its connection's app). */
  appIdFilter?: string
  /** Where to link when the org has no endpoints yet (the "create" affordance). */
  manageEndpointsHref?: string
}

/**
 * One dialog, two grouped sections. Search filters both groups by label / app title /
 * endpoint name. Picking a row fires `onSelect` with the discriminated source; the caller
 * owns the follow-up (topic sub-pick, token editor, persist).
 */
export function TriggerSourcePicker({
  open,
  onOpenChange,
  onSelect,
  surface = 'agent',
  appIdFilter,
  manageEndpointsHref,
}: TriggerSourcePickerProps) {
  const { appSources, endpointSources, isLoading } = useTriggerSources({ surface, appIdFilter })
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  const q = search.trim().toLowerCase()

  const filteredApps = useMemo(() => {
    if (!q) return appSources
    return appSources.filter(
      (s) =>
        s.trigger.label.toLowerCase().includes(q) ||
        (s.trigger.description ?? '').toLowerCase().includes(q) ||
        s.installation.app.title.toLowerCase().includes(q)
    )
  }, [appSources, q])

  const filteredEndpoints = useMemo(() => {
    if (!q) return endpointSources
    return endpointSources.filter((s) => s.endpoint.name.toLowerCase().includes(q))
  }, [endpointSources, q])

  const nothing = !isLoading && filteredApps.length === 0 && filteredEndpoints.length === 0

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
          <DialogHeader className='mb-0 flex h-10 flex-row items-center justify-between border-b px-3'>
            <Button variant='ghost' size='sm'>
              Choose a trigger
            </Button>
            <DialogTitle className='sr-only'>Choose a trigger</DialogTitle>
            <DialogDescription className='sr-only'>
              Pick an app webhook trigger or a webhook endpoint to drive this.
            </DialogDescription>
          </DialogHeader>

          <div className='border-b px-3 py-2'>
            <InputSearch
              ref={searchInputRef}
              placeholder='Search triggers...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
            />
          </div>

          <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
            <div className='px-3 py-3'>
              {isLoading ? (
                <div className='py-12 text-center text-sm text-muted-foreground'>Loading…</div>
              ) : nothing ? (
                <div className='py-12 text-center text-sm text-muted-foreground'>
                  {q
                    ? `No triggers match "${search}".`
                    : 'No app triggers or webhook endpoints yet.'}
                </div>
              ) : (
                <div className='space-y-4'>
                  {filteredApps.length > 0 && (
                    <Section title='Apps'>
                      {filteredApps.map((s) => (
                        <ToolSelectRow
                          key={`${s.installation.installationId}:${s.trigger.triggerId}`}
                          id={`${s.installation.installationId}:${s.trigger.triggerId}`}
                          iconId={s.installation.app.avatarUrl ?? 'package'}
                          color={null}
                          label={s.trigger.label}
                          description={s.trigger.description}
                          subtitle={s.installation.app.title}
                          installed={false}
                          onSelect={() => onSelect(s)}
                        />
                      ))}
                    </Section>
                  )}

                  <Section title='Webhook endpoints'>
                    {filteredEndpoints.length > 0 ? (
                      filteredEndpoints.map((s) => (
                        <ToolSelectRow
                          key={s.endpoint.id}
                          id={s.endpoint.id}
                          iconId='webhook'
                          color={null}
                          label={s.endpoint.name}
                          description={s.endpoint.url}
                          subtitle={`${s.endpoint.verification} verification`}
                          installed={false}
                          onSelect={() => onSelect(s)}
                        />
                      ))
                    ) : (
                      <EmptyEndpoints href={manageEndpointsHref} />
                    )}
                  </Section>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1'>
      <p className='px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
        {title}
      </p>
      {children}
    </div>
  )
}

function EmptyEndpoints({ href }: { href?: string }) {
  return (
    <div className='flex flex-col items-center gap-2 rounded-md border border-dashed py-6 text-center'>
      <Webhook className='size-5 text-muted-foreground' />
      <p className='text-sm text-muted-foreground'>No webhook endpoints yet.</p>
      {href && (
        <Button variant='outline' size='sm' asChild>
          <a href={href}>Create a webhook endpoint</a>
        </Button>
      )}
    </div>
  )
}
