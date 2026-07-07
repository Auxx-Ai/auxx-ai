// apps/web/src/components/channels/ui/channel-placeholder-card.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { Plus } from 'lucide-react'

/**
 * Dashed placeholder/add card matching the ListCard shape — opens the channel gallery.
 * Mirrors the webhooks section's placeholder so the channels grid reads the same when empty.
 */
export function ChannelPlaceholderCard({ onClick }: { onClick: () => void }) {
  return (
    <ListCard
      variant='placeholder'
      classNames={{ icon: 'border-dashed' }}
      icon={<Plus className='size-4 text-muted-foreground' />}
      title='Add a channel'
      subtitle='Email, chat, social, phone'
      description='Connect a new channel to receive and manage messages.'
      onClick={onClick}
    />
  )
}
