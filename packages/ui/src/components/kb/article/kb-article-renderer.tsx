// packages/ui/src/components/kb/article/kb-article-renderer.tsx

import { BlockRenderer } from './block-renderer'
import styles from './kb-article-renderer.module.css'
import type { DocJSON } from './types'

interface KBArticleRendererProps {
  doc: DocJSON | null | undefined
  /** Optional title rendered as <h1>; the doc's heading levels start at <h2>. */
  title?: string
  description?: string | null
}

export function KBArticleRenderer({ doc, title, description }: KBArticleRendererProps) {
  return (
    <article className={styles.article}>
      {title ? <h1 className={styles.h1}>{title}</h1> : null}
      {description ? <p className={styles.text}>{description}</p> : null}
      {doc?.content?.map((node, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable per render
        <BlockRenderer key={idx} node={node} idx={idx} doc={doc} />
      ))}
    </article>
  )
}
