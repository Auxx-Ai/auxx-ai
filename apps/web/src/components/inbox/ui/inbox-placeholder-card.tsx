// apps/web/src/components/inbox/ui/inbox-placeholder-card.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { Plus } from 'lucide-react'

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
      title='Add an inbox'
      subtitle='Shared or personal'
      description='Create a new inbox to organize your messages.'
      onClick={onClick}
    />
  )
}
