// packages/ui/src/components/kb/article/kb-article-renderer.tsx

import { BlockRenderer } from './block-renderer'
import { extractKBHeadings } from './extract-headings'
import styles from './kb-article-renderer.module.css'
import type { DocJSON } from './types'

interface KBArticleRendererProps {
  doc: DocJSON | null | undefined
  /** Optional title rendered as <h1>; the doc's heading levels start at <h2>. */
  title?: string
  description?: string | null
  updatedAt?: Date | string | null
}

export function KBArticleRenderer({ doc, title, description, updatedAt }: KBArticleRendererProps) {
  const headingIds = doc ? buildHeadingIdMap(doc) : {}
  return (
    <article className={styles.article}>
      {title ? <h1 className={styles.h1}>{title}</h1> : null}
      {description ? <p className={styles.text}>{description}</p> : null}
      {updatedAt ? (
        <p className='text-xs text-[var(--kb-fg)]/60 -mt-2'>
          Last updated {formatRelative(updatedAt)}
        </p>
      ) : null}
      {doc?.content?.map((node, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable per render
        <BlockRenderer key={idx} node={node} idx={idx} doc={doc} headingIds={headingIds} />
      ))}
    </article>
  )
}

function buildHeadingIdMap(doc: DocJSON): Record<number, string> {
  const headings = extractKBHeadings(doc)
  // extractKBHeadings preserves order; rebuild a map keyed by block index.
  const map: Record<number, string> = {}
  let cursor = 0
  doc.content.forEach((node, idx) => {
    if (node.attrs?.blockType !== 'heading') return
    const level = node.attrs?.level ?? 1
    if (level !== 1 && level !== 2) return
    const heading = headings[cursor]
    if (heading) map[idx] = heading.id
    cursor++
  })
  return map
}

function formatRelative(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const sec = Math.round(diff / 1000)
  const min = Math.round(sec / 60)
  const hour = Math.round(min / 60)
  const day = Math.round(hour / 24)
  const month = Math.round(day / 30)
  const year = Math.round(day / 365)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (Math.abs(year) >= 1) return rtf.format(-year, 'year')
  if (Math.abs(month) >= 1) return rtf.format(-month, 'month')
  if (Math.abs(day) >= 1) return rtf.format(-day, 'day')
  if (Math.abs(hour) >= 1) return rtf.format(-hour, 'hour')
  if (Math.abs(min) >= 1) return rtf.format(-min, 'minute')
  return rtf.format(-sec, 'second')
}
