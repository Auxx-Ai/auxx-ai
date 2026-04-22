// apps/web/src/components/drawers/tabs/contact-conversations-tab.tsx
'use client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Loader2, Mail, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { EmptyState } from '~/components/global/empty-state'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { MailFilterProvider } from '~/components/mail/mail-filter-context'
import { MailThreadItem } from '~/components/mail/mail-thread-item'
import { ThreadDetailsDialog } from '~/components/mail/thread-details-dialog'
import { useThreadList } from '~/components/threads/hooks/use-thread-list'
import { useCompose } from '~/hooks/use-compose'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Conversations tab for contact drawer - displays email threads
 */
export function ContactConversationsTab({ entityInstanceId, record }: DrawerTabProps) {
  const contactEmail = record?.secondaryInfo as string | undefined
  const contactName = (record?.primaryInfo as string | undefined) ?? contactEmail
  const { openCompose } = useCompose()
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)

  const handleCreateMessage = useCallback(() => {
    if (!contactEmail) return
    const presetValues: EditorPresetValues = {
      to: [
        {
          id: entityInstanceId,
          identifier: contactEmail,
          identifierType: 'EMAIL',
          name: contactName,
        },
      ],
    }
    openCompose({ presetValues })
  }, [contactEmail, contactName, entityInstanceId, openCompose])

  const filter: ConditionGroup[] = useMemo(() => {
    if (!contactEmail) return []
    return [
      {
        id: 'contact-email-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'from-match',
            fieldId: 'from',
            operator: 'is',
            value: contactEmail,
          },
        ],
      },
    ]
  }, [contactEmail])

  const {
    recordIds,
    isLoading: isLoadingIds,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useThreadList({
    filter,
    sort: { field: 'lastMessageAt', direction: 'desc' },
    enabled: !!contactEmail,
  })

  // Drafts could appear in recordIds in the future; this tab only renders threads.
  const threadIds = useMemo(() => {
    return recordIds
      .map((id) => parseRecordId(id))
      .filter(({ entityDefinitionId }) => entityDefinitionId === 'thread')
      .map(({ entityInstanceId }) => entityInstanceId)
  }, [recordIds])

  const { ref, inView } = useInView({ threshold: 0 })
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, fetchNextPage, hasNextPage, isFetchingNextPage])

  const isLoading = !contactEmail || isLoadingIds

  if (isLoading) {
    return (
      <div className='flex items-center justify-center flex-1 w-full'>
        <EmptyState
          icon={Mail}
          iconClassName='animate-spin'
          title='Loading messages'
          description='Fetching messages for this customer...'
          button={<div className='h-7' />}
        />
      </div>
    )
  } else if (threadIds.length === 0) {
    return (
      <div className='flex items-center justify-center flex-1 w-full'>
        <EmptyState
          icon={Mail}
          title='No messages found'
          description='Create a message for this contact'
          button={
            <Button variant='outline' size='sm' onClick={handleCreateMessage}>
              <Plus />
              Create Message
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <>
      <ScrollArea className='flex-1'>
        <Section
          title='Conversations'
          className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
          collapsible={false}
          icon={<Mail className='size-4 text-muted-foreground/50' />}
          actions={
            <Button variant='ghost' size='sm' onClick={handleCreateMessage}>
              <Plus />
              Create Message
            </Button>
          }>
          <MailFilterProvider
            value={{
              contextType: 'contact',
              contextId: entityInstanceId,
              statusSlug: 'all',
              selectedThreadIds: openThreadId ? [openThreadId] : [],
              viewMode: 'view',
              sortBy: 'newest',
              sortDirection: 'desc',
              filterConditions: filter,
            }}>
            <div className='space-y-2 p-4 pb-6'>
              {threadIds.map((threadId) => (
                <MailThreadItem
                  key={threadId}
                  threadId={threadId}
                  basePath=''
                  isSelected={threadId === openThreadId}
                  handleThreadClick={(id) => setOpenThreadId(id)}
                  threadIds={threadIds}
                />
              ))}
            </div>
          </MailFilterProvider>

          <div className='pb-4'>
            {isFetchingNextPage && (
              <div className='flex h-8 w-full items-center justify-center'>
                <div>
                  <Loader2 className='h-4 w-4 animate-spin' />
                </div>
              </div>
            )}

            <div ref={ref} className='h-1'></div>
            {!hasNextPage && (
              <div className='flex items-center justify-center text-sm'>End of list...</div>
            )}
          </div>
        </Section>
      </ScrollArea>
      <ThreadDetailsDialog
        threadId={openThreadId}
        open={!!openThreadId}
        onOpenChange={(o) => !o && setOpenThreadId(null)}
      />
    </>
  )
}
