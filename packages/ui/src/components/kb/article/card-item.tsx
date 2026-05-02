// packages/ui/src/components/kb/article/card-item.tsx
//
// Server component. Renders a single card inside a `cards` block. The `href`
// is one of:
//   - `auxx://kb/article/{id}` — emitted as the consumer-controlled redirect
//     route (default `/r/{id}`); the server resolves the slug on click.
//   - http(s)/mailto raw URL — used verbatim, opens in a new tab.
//   - empty / unsupported — non-interactive card surface.

import { EntityIcon } from '@auxx/ui/components/icons'
import type { ReactNode } from 'react'
import { renderMarkdownLite } from '../utils/markdown-lite'
import styles from './kb-article-renderer.module.css'
import type { CardData, ResolveAuxxHref } from './types'

const AUXX_KB_PREFIX = 'auxx://kb/article/'

interface CardItemProps {
  card: CardData
  resolveAuxxHref?: ResolveAuxxHref
}

interface ResolvedHref {
  href: string
  external: boolean
}

const defaultResolveAuxxHref: ResolveAuxxHref = (id) => `/r/${id}`

function resolveHref(
  raw: string | undefined,
  resolveAuxxHref: ResolveAuxxHref
): ResolvedHref | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (trimmed.startsWith(AUXX_KB_PREFIX)) {
    const articleId = trimmed.slice(AUXX_KB_PREFIX.length)
    if (!articleId) return null
    return { href: resolveAuxxHref(articleId), external: false }
  }
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('/')
  ) {
    return { href: trimmed, external: !trimmed.startsWith('/') }
  }
  return null
}

export function CardItem({ card, resolveAuxxHref }: CardItemProps) {
  const resolver = resolveAuxxHref ?? defaultResolveAuxxHref
  const resolved = resolveHref(card.href, resolver)

  const body: ReactNode = (
    <>
      {card.iconId ? (
        <span className={styles.cardIcon} aria-hidden='true'>
          <EntityIcon iconId={card.iconId} variant='bare' size='sm' />
        </span>
      ) : null}
      <span className={styles.cardTitle}>{card.title || 'Untitled'}</span>
      {card.description ? (
        <span className={styles.cardDescription}>
          {renderMarkdownLite(card.description, { resolveAuxxHref: resolver })}
        </span>
      ) : null}
    </>
  )

  if (!resolved) {
    return (
      <div className={styles.kbCard} data-interactive='false' role='listitem'>
        {body}
      </div>
    )
  }

  return (
    <a
      className={styles.kbCard}
      data-interactive='true'
      role='listitem'
      href={resolved.href}
      target={resolved.external ? '_blank' : undefined}
      rel={resolved.external ? 'noopener noreferrer' : undefined}>
      {body}
    </a>
  )
}
