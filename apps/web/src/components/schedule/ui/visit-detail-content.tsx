// apps/web/src/components/schedule/ui/visit-detail-content.tsx
//
// The Visit tab + Notes tab body (08-worker-surface.md §3), shared by the full-page route
// (mobile) and the desktop `VisitDrawer`. Reads `api.dispatch.getMyVisit` — money-hidden by
// construction: the server payload never includes price fields, this component never re-adds
// them. The Notes tab is the quality checklist (08-worker-surface.md §5, `qc/qc-checklist.tsx`).

'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { ClipboardList, MapPin } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { EmptyState } from '~/components/global/empty-state'
import { LoadingSpinner } from '~/components/global/loading-content'
import { api } from '~/trpc/react'
import { QcChecklist } from './qc/qc-checklist'
import { VisitStatusButton } from './visit-status-button'

interface VisitDetailContentProps {
  visitId: string
}

/** `EEE, MMM d · h:mm a – h:mm a` in the visit's own timezone — never the browser's local zone. */
function formatVisitWindow(start: Date | null, end: Date | null, timezone: string): string {
  if (!start) return 'Not scheduled'
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  })
  const startLabel = `${dateFmt.format(start)} · ${timeFmt.format(start)}`
  if (!end) return startLabel
  return `${startLabel} – ${timeFmt.format(end)}`
}

export function VisitDetailContent({ visitId }: VisitDetailContentProps) {
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'visit' })
  const { data: visit, isLoading, error } = api.dispatch.getMyVisit.useQuery({ visitId })

  if (isLoading) return <LoadingSpinner />

  if (error || !visit) {
    return (
      <EmptyState
        icon={ClipboardList}
        title='Visit not found'
        description={error?.message ?? "This visit isn't assigned to you."}
      />
    )
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className='flex h-full flex-col'>
      <TabsList variant='outline' className='w-full justify-start rounded-b-none border-b'>
        <TabsTrigger value='visit' variant='outline'>
          Visit
        </TabsTrigger>
        <TabsTrigger value='notes' variant='outline'>
          Notes
        </TabsTrigger>
      </TabsList>

      <TabsContent value='visit' className='flex-1 min-h-0'>
        <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
          <div className='flex flex-col'>
            <Section title='General' icon={<MapPin className='size-4' />} collapsible={false}>
              <div className='flex flex-col gap-3'>
                <div>
                  <div className='text-sm font-medium'>
                    {visit.workOrder.contactDisplayName ?? 'No customer'}
                  </div>
                  {visit.workOrder.serviceAddress && (
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(visit.workOrder.serviceAddress)}`}
                      target='_blank'
                      rel='noreferrer'
                      className='text-sm text-info-600 underline underline-offset-2'>
                      {visit.workOrder.serviceAddress}
                    </a>
                  )}
                </div>

                <div className='text-sm text-muted-foreground'>
                  {formatVisitWindow(visit.startTime, visit.endTime, visit.timezone)}
                </div>

                <div className='text-sm'>
                  {visit.workOrder.number ? `#${visit.workOrder.number} · ` : ''}
                  {visit.workOrder.displayName ?? 'Untitled job'}
                </div>

                <VisitStatusButton
                  visitId={visit.id}
                  status={visit.status}
                  hasContact={!!visit.workOrder.contactDisplayName}
                  startTime={visit.startTime}
                  endTime={visit.endTime}
                />
              </div>
            </Section>

            <Section title='Instructions' collapsible={false}>
              <p className='text-sm text-muted-foreground whitespace-pre-wrap'>
                {visit.workOrder.instructions || 'No instructions provided.'}
              </p>
            </Section>

            <Section title='Line items' collapsible={false}>
              {visit.lines.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No line items on this job.</p>
              ) : (
                <ul className='flex flex-col gap-2'>
                  {visit.lines.map((line, index) => (
                    <li key={`${line.name}-${index}`} className='rounded-md border p-2 text-sm'>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='font-medium'>{line.name || 'Untitled item'}</span>
                        <span className='shrink-0 text-muted-foreground'>Qty {line.quantity}</span>
                      </div>
                      {line.description && (
                        <div className='mt-0.5 text-muted-foreground'>{line.description}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div className='h-8' />
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value='notes' className='flex-1 min-h-0'>
        <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
          <QcChecklist visitId={visitId} />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )
}
