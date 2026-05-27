// packages/chat/src/views/home/cards/article-icon.tsx
//
// Tiny widget-side resolver: takes the `iconId` stored on `Article.emoji`
// (kebab-case Lucide id like `book-open`, despite the column name) and
// renders the matching Lucide component via the shared `@auxx/ui/components/
// icon-data` catalog. Falls back to `FileText` when the id is missing or
// unknown so we never render a literal id string.

import { getIcon } from '@auxx/ui/components/icon-data'
import { FileText } from 'lucide-react'

interface ArticleIconProps {
  iconId: string | null
  className?: string
}

export function ArticleIcon({ iconId, className }: ArticleIconProps) {
  const cls = className ?? 'size-4 shrink-0 text-muted-foreground'
  const entry = iconId ? getIcon(iconId) : null
  const Icon = entry?.icon ?? FileText
  return <Icon className={cls} aria-hidden='true' />
}
