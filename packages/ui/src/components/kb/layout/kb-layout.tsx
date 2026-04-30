// packages/ui/src/components/kb/layout/kb-layout.tsx

import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode } from 'react'
import { KBThemeProvider } from '../theme/kb-theme-provider'
import type { KBMode, KBThemeInput } from '../theme/kb-theme-tokens'
import type { KBNavLink } from './kb-header'
import { KBLayoutShell } from './kb-layout-shell'
import type { KBSidebarArticle, KBSidebarListStyle } from './kb-sidebar-tree'

export interface KBLayoutKB extends KBThemeInput {
  name: string
  defaultMode?: string | null
  showMode?: boolean | null
  logoLight?: string | null
  logoDark?: string | null
  searchbarPosition?: string | null
  headerNavigation?: unknown
  footerNavigation?: unknown
  /** Visual template — clean | muted | gradient | bold. */
  theme?: string | null
  /** Active-item style in the sidebar — default | pill | line. */
  sidebarListStyle?: string | null
  /** When false, navigation links hide but logo/search/mode toggle remain. */
  headerEnabled?: boolean | null
  /** When false, footer navigation columns hide but copyright line remains. */
  footerEnabled?: boolean | null
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
  /** Intercept sidebar article clicks (used by admin preview to swap article without navigation). */
  onArticleClick?: (articleId: string) => void
  /** When true, drops the `min-h-screen` so the layout sizes to its content (used when embedded inside the admin editor preview). */
  embedded?: boolean
  children: ReactNode
}

export function KBLayout<T extends KBSidebarArticle>({
  kb,
  articles,
  basePath,
  searchOrigin,
  activeArticleId,
  mode,
  onArticleClick,
  embedded = false,
  children,
}: KBLayoutProps<T>) {
  const headerNav = parseNavigation(kb.headerNavigation)
  const footerNav = parseNavigation(kb.footerNavigation)
  const searchbarPosition: 'center' | 'corner' =
    kb.searchbarPosition === 'corner' ? 'corner' : 'center'
  const effectiveMode: KBMode = mode ?? (kb.defaultMode === 'dark' ? 'dark' : 'light')
  const listStyle: KBSidebarListStyle =
    kb.sidebarListStyle === 'pill' || kb.sidebarListStyle === 'line'
      ? kb.sidebarListStyle
      : 'default'

  return (
    <KBThemeProvider kb={kb} mode={effectiveMode}>
      <div
        data-slot='kb-layout'
        className={cn(
          '@container relative flex flex-col bg-[var(--kb-page-bg)] font-[var(--kb-font,system-ui)] text-[var(--kb-fg)]',
          embedded ? 'flex-1' : 'min-h-screen'
        )}>
        <KBLayoutShell
          kbId={kb.id}
          kbName={kb.name}
          articles={articles}
          basePath={basePath}
          searchOrigin={searchOrigin}
          activeArticleId={activeArticleId}
          effectiveMode={effectiveMode}
          showMode={kb.showMode !== false}
          headerEnabled={kb.headerEnabled !== false}
          footerEnabled={kb.footerEnabled !== false}
          searchbarPosition={searchbarPosition}
          logoLight={kb.logoLight}
          logoDark={kb.logoDark}
          headerNav={headerNav}
          footerNav={footerNav}
          listStyle={listStyle}
          onArticleClick={onArticleClick}>
          {children}
        </KBLayoutShell>
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
