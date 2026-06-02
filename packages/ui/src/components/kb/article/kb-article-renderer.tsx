// packages/ui/src/components/kb/article/kb-article-renderer.tsx

import { EntityIcon } from '@auxx/ui/components/icons'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { extractKBHeadings, type KBHeading } from './extract-headings'
import { KBArticleNode } from './kb-article-node'
import styles from './kb-article-renderer.module.css'
import { KBTableOfContentsDrawer } from './kb-toc-drawer'
import type { DocJSON, ResolveAuxxHref } from './types'

/**
 * The container class that establishes KB article base typography (font,
 * size, color via `--kb-*` tokens) and the descendant `.kb-link` /
 * `.kb-inline-code` / `.kb-mark` styling. Apply it to any element that renders
 * `KBArticleNode` children outside of `KBArticleRenderer` (e.g. the diff view)
 * so the output matches the published article instead of inheriting nothing.
 */
export const kbArticleContainerClass = styles.article

export interface KBArticleRendererProps {
  doc: DocJSON | null | undefined
  /** Optional title rendered as <h1>; the doc's heading levels start at <h2>. */
  title?: string
  /** Icon id (from ICON_DATA) rendered inline left of the title. */
  emoji?: string | null
  description?: string | null
  /** Optional 16:9 hero rendered above the header. */
  coverImage?: string | null
  updatedAt?: Date | string | null
  /** Parent category/section rendered as a small link above the title. Omit when the article has no parent. */
  parent?: { title: string; emoji?: string | null; href?: string | null }
  /**
   * Slot for the Copy / View-as-Markdown action cluster. Apps pass a
   * pre-instantiated client wrapper here because the converter
   * (`@auxx/lib/kb/markdown`) lives outside the UI package's dep tier.
   */
  copyMenu?: ReactNode
  /**
   * Slot for the desktop "show TOC" toggle button. Rendered to the right of
   * the mobile drawer trigger. Apps using `KBArticleWithToc` pass a
   * visibility-managed button here so the layout stays stable when the
   * rail is collapsed.
   */
  tocToggle?: ReactNode
  /** Override how `auxx://kb/article/{id}` link/card hrefs are emitted.
   * Defaults to `/r/{id}` — public KB hosts a redirect handler at that
   * path. Preview/embed contexts override to nest under their URL prefix. */
  resolveAuxxHref?: ResolveAuxxHref
}

export function KBArticleRenderer({
  doc,
  title,
  emoji,
  description,
  coverImage,
  updatedAt,
  parent,
  copyMenu,
  tocToggle,
  resolveAuxxHref,
}: KBArticleRendererProps) {
  const headings = doc ? extractKBHeadings(doc) : []
  const headingIds = doc ? buildHeadingIdMap(doc, headings) : {}
  return (
    <article className={styles.article}>
      {coverImage ? <img src={coverImage} alt='' className={styles.cover} /> : null}
      {parent || title || description || updatedAt ? (
        <header className={styles.header}>
          <div className={styles.headerTopRow}>
            <div className={styles.headerParent}>
              {parent?.href ? (
                <Link href={parent.href} prefetch={false} className={styles.parentLink}>
                  {parent.emoji ? (
                    <EntityIcon iconId={parent.emoji} variant='bare' size='xs' />
                  ) : null}
                  {parent.title}
                </Link>
              ) : parent ? (
                <span className={styles.parentText}>
                  {parent.emoji ? (
                    <EntityIcon iconId={parent.emoji} variant='bare' size='xs' />
                  ) : null}
                  {parent.title}
                </span>
              ) : null}
            </div>
            <div className={styles.headerActions}>
              {copyMenu}
              <KBTableOfContentsDrawer headings={headings} className='@kb-lg:hidden' />
              {tocToggle}
            </div>
          </div>
          {title ? (
            <h1 className={styles.h1}>
              <span className='inline-flex flex-row items-center'>
                {emoji ? <EntityIcon iconId={emoji} variant='bare' size='xl' /> : null}
                <span>{title}</span>
              </span>
            </h1>
          ) : null}
          {description ? <p className={styles.headerDescription}>{description}</p> : null}
          {updatedAt ? (
            <p className={styles.headerUpdatedAt}>Last updated {formatRelative(updatedAt)}</p>
          ) : null}
        </header>
      ) : null}
      {doc?.content?.map((node, idx) => (
        <KBArticleNode
          key={idx}
          node={node}
          idx={idx}
          doc={doc}
          headingIds={headingIds}
          resolveAuxxHref={resolveAuxxHref}
        />
      ))}
    </article>
  )
}

function buildHeadingIdMap(doc: DocJSON, headings: KBHeading[]): Record<number, string> {
  // extractKBHeadings preserves order; rebuild a map keyed by block index.
  // Container nodes (tabs/accordion) don't contribute headings to the TOC.
  const map: Record<number, string> = {}
  let cursor = 0
  doc.content.forEach((node, idx) => {
    if (node.type !== 'block') return
    if (node.attrs?.blockType !== 'heading') return
    const level = node.attrs?.level ?? 1
    if (level !== 1 && level !== 2 && level !== 3) return
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
