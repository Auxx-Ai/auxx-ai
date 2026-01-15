// apps/web/src/components/drawers/tabs/contact-conversations-tab.tsx
'use client'
import { Mail, Plus, Loader2 } from 'lucide-react'
import React, { useState, useEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import { EmptyState } from '~/components/global/empty-state'
import { MailContactThreadItem } from '~/components/mail/mail-contact/mail-contact-thread-item'
import { Button } from '@auxx/ui/components/button'
import useThreads from '~/hooks/use-threads-filter'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Conversations tab for contact drawer - displays email threads
 */
export function ContactConversationsTab({ entityInstanceId }: DrawerTabProps) {
  const contactId = entityInstanceId

  const { data: contact, isLoading: isLoadingContact } = api.contact.getById.useQuery(
    { id: contactId },
    { enabled: !!contactId }
  )

  const {
    threads,
    isLoading, // Represents initial fetch loading state
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useThreads(
    {
      contextType: 'all',
      searchQuery: `recipient:${contact?.email}`,
      // searchQuery: filter.searchQuery,
    },
    { enabled: contact && contact.email !== undefined, limit: 10 }
  )

  const { ref, inView } = useInView({ threshold: 0 })
  useEffect(() => {
    if (inView) {
      fetchNextPage()
    }
  }, [inView, fetchNextPage, hasNextPage, isFetchingNextPage])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <EmptyState
          icon={Mail}
          iconClassName="animate-spin"
          title="Loading messages"
          description="Fetching messages for this customer..."
          button={<div className="h-7" />}
        />
      </div>
    )
  } else if (threads && threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <EmptyState
          icon={Mail}
          title="No messages found"
          description="Create a message for this contact"
          button={
            // <CreateTicketDialog contactId={contactId}>
            <Button variant="outline" size="sm">
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
    <div className="relative h-full w-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 sticky top-0 z-1 pt-3 ">
        <h2 className="text-base flex items-center space-x-2 gap-2">
          <Mail className="h-5 w-5 text-muted-foreground/50" />
          Conversations
        </h2>
        {/* <CreateTicketDialog contactId={contactId}> */}
        <Button variant="outline" size="sm">
          <Plus />
          Create Message
        </Button>
        {/* </CreateTicketDialog> */}
      </div>
      <div className="space-y-4 dark:bg-muted/10 p-4 pb-6">
        {threads.map((thread) => (
          <MailContactThreadItem key={thread.id} item={thread} />
        ))}
      </div>

      <div className="pb-4">
        {isFetchingNextPage && (
          <div className="flex h-8 w-full items-center justify-center">
            <div>
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        <div ref={ref} className="h-1"></div>
        {!hasNextPage && (
          <div className="flex items-center justify-center text-sm">End of list...</div>
        )}
      </div>
    </div>
  )
}
