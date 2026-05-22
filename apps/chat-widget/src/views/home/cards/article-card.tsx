// apps/chat-widget/src/views/home/cards/article-card.tsx

import { ArticleIcon } from './article-icon'
import { HomeCard } from './card'

interface ArticleCardProps {
  title: string
  description: string | null
  // Despite the prop name (matching the DB column `Article.emoji`), this
  // carries a kebab-case Lucide icon id, not a literal emoji character.
  emoji: string | null
  onClick: () => void
}

export function ArticleCard({ title, description, emoji, onClick }: ArticleCardProps) {
  return (
    <HomeCard onClick={onClick}>
      <div className='flex items-center gap-2'>
        <ArticleIcon iconId={emoji} />
        <span className='truncate text-sm font-medium text-[color:var(--color-fg)]'>{title}</span>
      </div>
      {description ? (
        <span className='line-clamp-2 text-xs text-[color:var(--color-muted)]'>{description}</span>
      ) : null}
    </HomeCard>
  )
}
