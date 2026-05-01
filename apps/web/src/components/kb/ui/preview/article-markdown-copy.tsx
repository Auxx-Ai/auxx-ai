// apps/web/src/components/kb/ui/preview/article-markdown-copy.tsx

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
 * shared `KBArticleCopyMenu`. The UI package itself can't depend on
 * `@auxx/lib`, so each consuming app wires the converter here.
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
