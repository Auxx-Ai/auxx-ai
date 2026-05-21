// apps/chat-widget/src/views/home/cards/browse-all-card.tsx

import { BookOpen } from 'lucide-react'
import { HomeCard } from './card'

interface BrowseAllCardProps {
  siteName: string
  onClick: () => void
}

export function BrowseAllCard({ siteName, onClick }: BrowseAllCardProps) {
  return (
    <HomeCard onClick={onClick}>
      <div className='flex items-center gap-2'>
        <BookOpen
          className='size-4 shrink-0 text-[color:var(--color-primary)]'
          aria-hidden='true'
        />
        <span className='text-sm font-medium text-[color:var(--color-fg)]'>
          Browse all articles
        </span>
      </div>
      <span className='truncate text-xs text-[color:var(--color-muted)]'>{siteName}</span>
    </HomeCard>
  )
}
