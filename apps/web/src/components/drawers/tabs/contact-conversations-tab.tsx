// apps/web/src/components/drawers/tabs/contact-conversations-tab.tsx
'use client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Loader2, Mail, Plus } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useInView } from 'react-intersection-observer'
import { EmptyState } from '~/components/global/empty-state'
import { MailContactThreadItem } from '~/components/mail/mail-contact/mail-contact-thread-item'
import { useThreadList } from '~/components/threads/hooks/use-thread-list'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Conversations tab for contact drawer - displays email threads
 */
export function ContactConversationsTab({ record }: DrawerTabProps) {
  const contactEmail = record?.email as string | undefined

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
    threads,
    isLoading: isLoadingThreads,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useThreadList({ filter, sort: { field: 'lastMessageAt', direction: 'desc' } })

  const { ref, inView } = useInView({ threshold: 0 })
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, fetchNextPage, hasNextPage, isFetchingNextPage])

  const isLoading = !contactEmail || isLoadingThreads

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
  } else if (threads && threads.length === 0) {
    return (
      <div className='flex items-center justify-center flex-1 w-full'>
        <EmptyState
          icon={Mail}
          title='No messages found'
          description='Create a message for this contact'
          button={
            // <CreateTicketDialog contactId={contactId}>
            <Button variant='outline' size='sm'>
              <Plus />
              Create Message
            </Button>
            // </CreateTicketDialog>
          }
        />
      </div>
    )
  }

  return (
    <ScrollArea className='flex-1'>
      <Section
        title='Conversations'
        className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
        collapsible={false}
        icon={<Mail className='size-4 text-muted-foreground/50' />}
        actions={
          <Button variant='ghost' size='sm'>
            <Plus />
            Create Message
          </Button>
        }>
        <div className='space-y-4 dark:bg-muted/10 p-4 pb-6'>
          {threads.map((thread) => (
            <MailContactThreadItem key={thread.id} item={thread} />
          ))}
        </div>

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
  )
}
