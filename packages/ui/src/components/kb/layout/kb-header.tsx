// packages/ui/src/components/kb/layout/kb-header.tsx

import Link from 'next/link'
import { KBSearchInput } from '../search/kb-search-input'
import { KBModeToggle } from '../theme/kb-mode-toggle'
import type { KBMode } from '../theme/kb-theme-tokens'
import styles from './kb-layout.module.css'

export interface KBNavLink {
  label: string
  href: string
}

export interface KBHeaderProps {
  kbId: string
  homeHref: string
  basePath: string
  title: string
  logoLight?: string | null
  logoDark?: string | null
  mode: KBMode
  showMode?: boolean
  navigation?: KBNavLink[]
  /** When 'center', search renders in the header. When 'corner', search is in <KBSidebar/>. */
  searchbarPosition?: 'center' | 'corner' | null
  searchOrigin?: string
}

export function KBHeader({
  kbId,
  homeHref,
  basePath,
  title,
  logoLight,
  logoDark,
  mode,
  showMode = true,
  navigation,
  searchbarPosition = 'center',
  searchOrigin,
}: KBHeaderProps) {
  const logo = mode === 'dark' ? (logoDark ?? logoLight) : (logoLight ?? logoDark)
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href={homeHref} className={styles.logo}>
          {logo ? <img src={logo} alt={title} /> : <span>{title}</span>}
        </Link>

        {searchbarPosition === 'center' && searchOrigin ? (
          <div className={styles.headerSearch}>
            <KBSearchInput searchOrigin={searchOrigin} basePath={basePath} />
          </div>
        ) : null}

        <nav className={styles.nav}>
          {navigation?.map((link) => (
            <Link key={link.href} href={link.href} className={styles.navLink} prefetch={false}>
              {link.label}
            </Link>
          ))}
          {showMode ? <KBModeToggle kbId={kbId} initialMode={mode} /> : null}
        </nav>
      </div>
    </header>
  )
}
