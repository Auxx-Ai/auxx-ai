// packages/ui/src/components/kb/layout/kb-footer.tsx

import Link from 'next/link'
import type { KBNavLink } from './kb-header'
import styles from './kb-layout.module.css'

interface KBFooterProps {
  title: string
  navigation?: KBNavLink[]
}

export function KBFooter({ title, navigation }: KBFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>
          © {new Date().getFullYear()} {title}
        </span>
        {navigation && navigation.length > 0 ? (
          <nav className={styles.footerNav}>
            {navigation.map((link) => (
              <Link key={link.href} href={link.href} className={styles.navLink} prefetch={false}>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </footer>
  )
}
