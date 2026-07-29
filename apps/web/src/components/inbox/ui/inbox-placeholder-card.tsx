// apps/web/src/components/inbox/ui/inbox-placeholder-card.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { Lock, Plus } from 'lucide-react'

/**
 * Dashed placeholder/add card matching the ListCard shape — opens the create
 * inbox dialog. Mirrors the channels grid's placeholder so the inbox grid reads
 * the same when empty.
 */
export function InboxPlaceholderCard({ onClick }: { onClick: () => void }) {
  return (
    <ListCard
      variant='placeholder'
      classNames={{ icon: 'border-dashed' }}
      icon={<Plus className='size-4 text-muted-foreground' />}
      title='Create shared inbox'
      subtitle='For your team'
      description='Create a shared queue to organize team messages.'
      onClick={onClick}
    />
  )
}

/** Personal-account connect tile for the member-facing inbox settings page. */
export function PersonalInboxPlaceholderCard({ onClick }: { onClick: () => void }) {
  return (
    <ListCard
      variant='placeholder'
      classNames={{ icon: 'border-dashed' }}
      icon={<Lock className='size-4 text-muted-foreground' />}
      title='Connect personal account'
      subtitle='Gmail or Outlook'
      description='Create a private inbox connected to your own mailbox.'
      onClick={onClick}
    />
  )
}
