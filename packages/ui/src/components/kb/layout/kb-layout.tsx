// packages/ui/src/components/kb/layout/kb-layout.tsx

import type { ReactNode } from 'react'
import { KBThemeProvider } from '../theme/kb-theme-provider'
import type { KBMode, KBThemeInput } from '../theme/kb-theme-tokens'
import { KBFooter } from './kb-footer'
import { KBHeader, type KBNavLink } from './kb-header'
import styles from './kb-layout.module.css'
import { KBSidebar } from './kb-sidebar'
import type { KBSidebarArticle } from './kb-sidebar-tree'

export interface KBLayoutKB extends KBThemeInput {
  name: string
  defaultMode?: string | null
  showMode?: boolean | null
  logoLight?: string | null
  logoDark?: string | null
  searchbarPosition?: string | null
  headerNavigation?: unknown
  footerNavigation?: unknown
}

interface KBLayoutProps<T extends KBSidebarArticle> {
  kb: KBLayoutKB
  articles: T[]
  /** Base path for article links, e.g. `/<orgSlug>/<kbSlug>`. */
  basePath: string
  /** Origin used to fetch the search index, e.g. `/<orgSlug>/<kbSlug>/_search.json`. */
  searchOrigin?: string
  activeArticleId?: string
  /** Mode override (admin preview). When omitted, kb.defaultMode applies. */
  mode?: KBMode
  children: ReactNode
}

export function KBLayout<T extends KBSidebarArticle>({
  kb,
  articles,
  basePath,
  searchOrigin,
  activeArticleId,
  mode,
  children,
}: KBLayoutProps<T>) {
  const headerNav = parseNavigation(kb.headerNavigation)
  const footerNav = parseNavigation(kb.footerNavigation)
  const searchbarPosition = (kb.searchbarPosition === 'corner' ? 'corner' : 'center') as
    | 'center'
    | 'corner'
  const effectiveMode: KBMode = mode ?? (kb.defaultMode === 'dark' ? 'dark' : 'light')

  return (
    <KBThemeProvider kb={kb} mode={effectiveMode}>
      <div className={styles.shell}>
        <KBHeader
          kbId={kb.id}
          homeHref={basePath || '/'}
          basePath={basePath}
          title={kb.name}
          logoLight={kb.logoLight}
          logoDark={kb.logoDark}
          mode={effectiveMode}
          showMode={kb.showMode !== false}
          navigation={headerNav}
          searchbarPosition={searchbarPosition}
          searchOrigin={searchOrigin}
        />
        <div className={styles.body}>
          <KBSidebar
            articles={articles}
            basePath={basePath}
            activeArticleId={activeArticleId}
            searchOrigin={searchOrigin}
            showSearch={searchbarPosition === 'corner'}
          />
          <main className={styles.content}>{children}</main>
        </div>
        <KBFooter title={kb.name} navigation={footerNav} />
      </div>
    </KBThemeProvider>
  )
}

function parseNavigation(value: unknown): KBNavLink[] {
  if (!Array.isArray(value)) return []
  const out: KBNavLink[] = []
  for (const item of value) {
    if (item && typeof item === 'object') {
      const label = (item as Record<string, unknown>).label
      const href = (item as Record<string, unknown>).href
      if (typeof label === 'string' && typeof href === 'string') {
        out.push({ label, href })
      }
    }
  }
  return out
}
