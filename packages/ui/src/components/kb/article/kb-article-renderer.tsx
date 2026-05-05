// packages/ui/src/components/kb/article/kb-article-renderer.tsx

import { EntityIcon } from '@auxx/ui/components/icons'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { AccordionBlock } from './accordion-block'
import { BlockRenderer } from './block-renderer'
import { extractKBHeadings, type KBHeading } from './extract-headings'
import styles from './kb-article-renderer.module.css'
import { KBTableOfContentsDrawer } from './kb-toc-drawer'
import { TabsBlock } from './tabs-block'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  DocJSON,
  PanelJSON,
  ResolveAuxxHref,
  TabsJSON,
} from './types'

interface KBArticleRendererProps {
  doc: DocJSON | null | undefined
  /** Optional title rendered as <h1>; the doc's heading levels start at <h2>. */
  title?: string
  /** Icon id (from ICON_DATA) rendered inline left of the title. */
  emoji?: string | null
  description?: string | null
  updatedAt?: Date | string | null
  /** Parent category/section rendered as a small link above the title. Omit when the article has no parent. */
  parent?: { title: string; emoji?: string | null; href?: string | null }
  /**
   * Slot for the Copy / View-as-Markdown action cluster. Apps pass a
   * pre-instantiated client wrapper here because the converter
   * (`@auxx/lib/kb/markdown`) lives outside the UI package's dep tier.
   */
  copyMenu?: ReactNode
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
  updatedAt,
  parent,
  copyMenu,
  resolveAuxxHref,
}: KBArticleRendererProps) {
  const headings = doc ? extractKBHeadings(doc) : []
  const headingIds = doc ? buildHeadingIdMap(doc, headings) : {}
  return (
    <article className={styles.article}>
      {parent || title || description || updatedAt ? (
        <header className={styles.header}>
          <div className={styles.headerMain}>
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
            {title ? (
              <h1 className={styles.h1}>
                <span className='inline-flex flex-row items-center gap-3'>
                  {emoji ? <EntityIcon iconId={emoji} variant='bare' size='xl' /> : null}
                  <span>{title}</span>
                </span>
              </h1>
            ) : null}
            {description ? <p className={styles.headerDescription}>{description}</p> : null}
            {updatedAt ? (
              <p className={styles.headerUpdatedAt}>Last updated {formatRelative(updatedAt)}</p>
            ) : null}
          </div>
          <div className='flex items-center gap-2'>
            <KBTableOfContentsDrawer headings={headings} className='@kb-lg:hidden' />
            {copyMenu}
          </div>
        </header>
      ) : null}
      {doc?.content?.map((node, idx) => {
        switch (node.type) {
          case 'tabs':
            return (
              <ServerTabsBlock
                // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable per render
                key={idx}
                node={node}
                resolveAuxxHref={resolveAuxxHref}
              />
            )
          case 'accordion':
            return (
              <ServerAccordionBlock
                // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable per render
                key={idx}
                node={node}
                resolveAuxxHref={resolveAuxxHref}
              />
            )
          case 'block':
            return (
              <BlockRenderer
                // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable per render
                key={idx}
                node={node}
                idx={idx}
                doc={doc}
                headingIds={headingIds}
                resolveAuxxHref={resolveAuxxHref}
              />
            )
          default:
            return null
        }
      })}
    </article>
  )
}

function renderPanelBody(
  panel: PanelJSON,
  resolveAuxxHref: ResolveAuxxHref | undefined
): ReactNode {
  // Panel bodies are flat block content; reuse BlockRenderer with a synthetic
  // sub-doc so heading-id maps stay scoped. We intentionally don't pass a
  // headingIds map — TOC headings are top-level only.
  const subDoc: DocJSON = { type: 'doc', content: panel.content }
  return panel.content.map((block: BlockJSON, i) => (
    <BlockRenderer
      // biome-ignore lint/suspicious/noArrayIndexKey: panel content order is stable per render
      key={i}
      node={block}
      idx={i}
      doc={subDoc}
      resolveAuxxHref={resolveAuxxHref}
    />
  ))
}

function ServerTabsBlock({
  node,
  resolveAuxxHref,
}: {
  node: TabsJSON
  resolveAuxxHref?: ResolveAuxxHref
}) {
  if (!Array.isArray(node.content) || node.content.length === 0) return null
  const panels = node.content.map((panel) => ({
    id: panel.attrs.id,
    label: panel.attrs.label,
    iconId: panel.attrs.iconId,
    body: renderPanelBody(panel, resolveAuxxHref),
  }))
  return <TabsBlock panels={panels} />
}

function ServerAccordionBlock({
  node,
  resolveAuxxHref,
}: {
  node: AccordionJSON
  resolveAuxxHref?: ResolveAuxxHref
}) {
  if (!Array.isArray(node.content) || node.content.length === 0) return null
  const items = node.content.map((panel) => ({
    id: panel.attrs.id,
    label: panel.attrs.label,
    body: renderPanelBody(panel, resolveAuxxHref),
  }))
  return <AccordionBlock items={items} allowMultiple={node.attrs.allowMultiple !== false} />
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
