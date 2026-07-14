// apps/web/src/components/sequences/ui/detail/sequence-detail-view.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError } from '@auxx/ui/components/toast'
import { Mails, Pause, Pencil, Play, Send, Settings, UsersRound } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { LoadingSpinner } from '~/components/global/loading-content'
import { Tooltip } from '~/components/global/tooltip'
import { api } from '~/trpc/react'
import { SequenceRecipients } from './sequence-recipients'
import { SequenceSettingsDrawer } from './sequence-settings-drawer'
import { SequenceStatsStrip } from './sequence-stats-strip'
import { SequenceStepEditor } from './sequence-step-editor'

interface SequenceDetailViewProps {
  sequenceId: string
}

/** Breadcrumb + shell shared by the loading / not-found / loaded states. */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Workflows' href='/app/workflows' />
          <MainPageBreadcrumbItem title='Sequences' href='/app/workflows?t=sequences' />
          <MainPageBreadcrumbItem title={title} last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>{children}</MainPageContent>
    </MainPage>
  )
}

/**
 * The sequence detail page: header (breadcrumb, publish-state badge, Publish,
 * pause/enable, Settings drawer trigger), the stats strip, and the
 * Editor | Recipients tabs (kb-style, persisted in the `tab` query param).
 */
export function SequenceDetailView({ sequenceId }: SequenceDetailViewProps) {
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'editor' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const utils = api.useUtils()

  const { data, isLoading } = api.sequence.get.useQuery({ id: sequenceId })

  const publish = api.sequence.publish.useMutation({
    onSuccess: () => utils.sequence.get.invalidate({ id: sequenceId }),
    onError: (error) =>
      toastError({ title: 'Failed to publish sequence', description: error.message }),
  })
  const update = api.sequence.update.useMutation({
    onSuccess: () => utils.sequence.get.invalidate({ id: sequenceId }),
    onError: (error) =>
      toastError({ title: 'Failed to update sequence', description: error.message }),
  })

  if (isLoading && !data) {
    return (
      <Shell title='Loading…'>
        <LoadingSpinner />
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell title='Not found'>
        <EmptyState
          icon={Mails}
          title='Sequence not found'
          description='This sequence may have been deleted.'
          button={<div className='h-12' />}
        />
      </Shell>
    )
  }

  const { sequence, steps } = data
  const isDraft = !sequence.publishedAt
  const isEnabled = sequence.status === 'enabled'

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {isDraft ? (
              <Badge variant='gray' size='sm'>
                Draft
              </Badge>
            ) : sequence.hasUnpublishedChanges ? (
              <Badge variant='amber' size='sm'>
                <Pencil />
                Unpublished changes
              </Badge>
            ) : null}

            {!isDraft && (
              <Tooltip
                content={
                  isEnabled
                    ? 'Pause — in-flight runs finish; new enrollments blocked'
                    : 'Enable enrollments'
                }>
                <Button
                  variant='ghost'
                  size='sm'
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate({
                      id: sequence.id,
                      fields: { status: isEnabled ? 'disabled' : 'enabled' },
                    })
                  }>
                  {isEnabled ? <Pause /> : <Play />}
                  {isEnabled ? 'Pause' : 'Enable'}
                </Button>
              </Tooltip>
            )}

            <Button
              variant='outline'
              size='sm'
              loading={publish.isPending}
              loadingText='Publishing…'
              disabled={steps.length === 0 || (!isDraft && !sequence.hasUnpublishedChanges)}
              onClick={() => publish.mutate({ id: sequence.id })}>
              <Send />
              Publish
            </Button>

            <Button variant='ghost' size='icon-sm' onClick={() => setSettingsOpen(true)}>
              <Settings />
            </Button>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Workflows' href='/app/workflows' />
          <MainPageBreadcrumbItem title='Sequences' href='/app/workflows?t=sequences' />
          <MainPageBreadcrumbItem title={sequence.name} last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <div className='flex h-full flex-1 flex-col min-h-0'>
          <SequenceStatsStrip sequenceId={sequenceId} />

          <Tabs value={tab} onValueChange={setTab} className='flex flex-1 flex-col min-h-0'>
            <TabsList className='w-full justify-start rounded-none border-b bg-primary-150'>
              <TabsTrigger value='editor' variant='outline'>
                <Mails />
                Editor
              </TabsTrigger>
              <TabsTrigger value='recipients' variant='outline'>
                <UsersRound />
                Recipients
              </TabsTrigger>
            </TabsList>

            <TabsContent value='editor' className='flex flex-1 flex-col min-h-0'>
              <ScrollArea className='h-full' scrollbarClassName='w-1.5' noFade>
                <SequenceStepEditor sequenceId={sequenceId} steps={steps} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value='recipients' className='flex flex-1 flex-col min-h-0'>
              <ScrollArea className='h-full' scrollbarClassName='w-1.5' noFade>
                <SequenceRecipients sequenceId={sequenceId} totalSteps={steps.length} />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </MainPageContent>

      {settingsOpen && (
        <SequenceSettingsDrawer
          sequence={sequence}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </MainPage>
  )
}
