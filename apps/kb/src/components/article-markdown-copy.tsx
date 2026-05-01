// apps/kb/src/components/article-markdown-copy.tsx

'use client'

import { type DocJSON, KBArticleCopyMenu } from '@auxx/ui/components/kb'
import { useCallback } from 'react'

interface ArticleMarkdownCopyProps {
  doc: DocJSON | null | undefined
  title?: string
  markdownHref?: string
}

/**
 * Client wrapper that injects the `@auxx/lib/kb/markdown` converter into the
 * shared `KBArticleCopyMenu`. Lives in the app layer because `packages/ui`
 * can't depend on `@auxx/lib` per the workspace dep tiers.
 */
export function ArticleMarkdownCopy({ doc, title, markdownHref }: ArticleMarkdownCopyProps) {
  const getMarkdown = useCallback(async () => {
    if (!doc) return ''
    const { blocksToMd } = await import('@auxx/lib/kb/markdown')
    const body = blocksToMd(doc)
    return title && title.trim().length > 0 ? `# ${title}\n\n${body}` : body
  }, [doc, title])

  return (
    <KBArticleCopyMenu getMarkdown={doc ? getMarkdown : undefined} markdownHref={markdownHref} />
  )
}
