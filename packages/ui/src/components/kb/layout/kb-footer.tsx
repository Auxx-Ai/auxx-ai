// packages/ui/src/components/kb/layout/kb-footer.tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { KBNavLink } from './kb-header'

interface KBFooterProps {
  title: string
  navigation?: KBNavLink[]
  navigationEnabled?: boolean
}

function CurrentYear() {
  const [year, setYear] = useState<number | null>(null)
  useEffect(() => setYear(new Date().getFullYear()), [])
  return <>{year}</>
}

export function KBFooter({ title, navigation, navigationEnabled = true }: KBFooterProps) {
  const showNav = navigationEnabled && navigation && navigation.length > 0
  return (
    <footer className='border-t border-[var(--kb-border)] px-6 py-6 text-sm text-[var(--kb-fg)]/75'>
      <div className='mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-6'>
        <span>
          © <CurrentYear /> {title}
        </span>
        {showNav ? (
          <nav className='flex flex-wrap gap-4'>
            {navigation?.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className='text-[var(--kb-fg)]/85 no-underline hover:text-[var(--kb-primary)] hover:opacity-100'
                prefetch={false}>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </footer>
  )
}
