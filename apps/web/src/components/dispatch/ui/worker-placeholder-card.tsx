// apps/web/src/components/dispatch/ui/worker-placeholder-card.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { Plus } from 'lucide-react'

/**
 * Dashed placeholder/add card matching the ListCard shape — opens the member
 * picker to add a new dispatch worker (the inbox-placeholder-card recipe).
 */
export function WorkerPlaceholderCard({ onClick }: { onClick: () => void }) {
  return (
    <ListCard
      variant='placeholder'
      classNames={{ icon: 'border-dashed' }}
      icon={<Plus className='size-4 text-muted-foreground' />}
      title='Add a worker'
      subtitle='Team member'
      description='Make a member schedulable on the dispatch board.'
      onClick={onClick}
    />
  )
}
