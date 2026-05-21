// apps/chat-widget/src/views/home/cards/article-card.tsx

import { FileText } from 'lucide-react'
import { HomeCard } from './card'

interface ArticleCardProps {
  title: string
  description: string | null
  emoji: string | null
  onClick: () => void
}

export function ArticleCard({ title, description, emoji, onClick }: ArticleCardProps) {
  return (
    <HomeCard onClick={onClick}>
      <div className='flex items-center gap-2'>
        {emoji ? (
          <span className='text-base leading-none' aria-hidden='true'>
            {emoji}
          </span>
        ) : (
          <FileText
            className='size-4 shrink-0 text-[color:var(--color-muted)]'
            aria-hidden='true'
          />
        )}
        <span className='truncate text-sm font-medium text-[color:var(--color-fg)]'>{title}</span>
      </div>
      {description ? (
        <span className='line-clamp-2 text-xs text-[color:var(--color-muted)]'>{description}</span>
      ) : null}
    </HomeCard>
  )
}
