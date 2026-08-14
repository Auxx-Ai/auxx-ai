// apps/web/src/components/drawers/tabs/contact-conversations-tab.tsx
'use client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Loader2, Mail, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { EmptyState } from '~/components/global/empty-state'
import { toEmailAddressList } from '~/components/mail/email-address-list'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { MailFilterProvider } from '~/components/mail/mail-filter-context'
import { MailThreadItem } from '~/components/mail/mail-thread-item'
import { ThreadDetailsDialog } from '~/components/mail/thread-details-dialog'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useThreadList } from '~/components/threads/hooks/use-thread-list'
import { useCompose } from '~/hooks/use-compose'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Conversations tab for contact drawer - displays email threads
 */
export function ContactConversationsTab({ entityInstanceId, record }: DrawerTabProps) {
  // ALL of the contact's addresses off its system field (LOCKED: the thread
  // filter must cover aliases, not just the primary that `secondaryInfo`
  // carries). Ordered by sortKey; index 0 is the primary.
  const contactRecordId = useMemo(() => toRecordId('contact', entityInstanceId), [entityInstanceId])
  const { values: contactValues, isLoading: isLoadingEmails } = useSystemValues(
    contactRecordId,
    ['primary_email'],
    { autoFetch: true }
  )
  const contactEmails = useMemo(
    () => toEmailAddressList(contactValues.primary_email),
    [contactValues]
  )
  const primaryEmail = contactEmails[0]
  const contactName = (record?.primaryInfo as string | undefined) ?? primaryEmail
  const { openCompose } = useCompose()
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)

  // Compose defaults to the primary address.
  const handleCreateMessage = useCallback(() => {
    if (!primaryEmail) return
    const presetValues: EditorPresetValues = {
      to: [
        {
          id: entityInstanceId,
          identifier: primaryEmail,
          identifierType: 'EMAIL',
          name: contactName,
        },
      ],
    }
    openCompose({ presetValues })
  }, [primaryEmail, contactName, entityInstanceId, openCompose])

  // Threads from ANY of the contact's addresses (OR across one `is` condition
  // per address).
  const filter: ConditionGroup[] = useMemo(() => {
    if (contactEmails.length === 0) return []
    return [
      {
        id: 'contact-email-filter',
        logicalOperator: 'OR' as const,
        conditions: contactEmails.map((email, index) => ({
          id: `from-match-${index}`,
          fieldId: 'from',
          operator: 'is',
          value: email,
        })),
      },
    ]
  }, [contactEmails])

  const {
    recordIds,
    isLoading: isLoadingIds,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useThreadList({
    filter,
    sort: { field: 'lastMessageAt', direction: 'desc' },
    enabled: contactEmails.length > 0,
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

  const isLoading = isLoadingEmails || (contactEmails.length > 0 && isLoadingIds)

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
            <div className='space-y-2 pb-6'>
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
