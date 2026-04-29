// packages/ui/src/components/kb/layout/kb-sidebar.tsx

import { KBSearchInput } from '../search/kb-search-input'
import styles from './kb-layout.module.css'
import { type KBSidebarArticle, KBSidebarTree } from './kb-sidebar-tree'

interface KBSidebarProps<T extends KBSidebarArticle> {
  articles: T[]
  basePath: string
  activeArticleId?: string
  searchOrigin?: string
  showSearch?: boolean
}

export function KBSidebar<T extends KBSidebarArticle>({
  articles,
  basePath,
  activeArticleId,
  searchOrigin,
  showSearch = false,
}: KBSidebarProps<T>) {
  return (
    <aside className={styles.sidebar}>
      {showSearch && searchOrigin ? (
        <div style={{ marginBottom: '1rem' }}>
          <KBSearchInput searchOrigin={searchOrigin} basePath={basePath} />
        </div>
      ) : null}
      <div className={styles.sidebarHeading}>Articles</div>
      <KBSidebarTree articles={articles} basePath={basePath} activeArticleId={activeArticleId} />
    </aside>
  )
}
