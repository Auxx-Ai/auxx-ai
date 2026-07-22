// apps/web/src/components/dispatch/ui/team-placeholder-card.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { Plus } from 'lucide-react'

/**
 * Dashed placeholder/add card matching the ListCard shape — opens the team
 * dialog to create a new dispatch team (45-teams.md §6).
 */
export function TeamPlaceholderCard({ onClick }: { onClick: () => void }) {
  return (
    <ListCard
      variant='placeholder'
      classNames={{ icon: 'border-dashed' }}
      icon={<Plus className='size-4 text-muted-foreground' />}
      title='Add a team'
      subtitle='Crew'
      description='Group individual workers into one dispatchable board row.'
      onClick={onClick}
    />
  )
}
