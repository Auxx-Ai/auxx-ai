// packages/ui/src/components/kb/layout/kb-header.tsx

import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import { KBSearchInput } from '../search/kb-search-input'
import { KBModeToggle } from '../theme/kb-mode-toggle'
import type { KBMode } from '../theme/kb-theme-tokens'

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
  navigationEnabled?: boolean
  /** When 'center', search renders in the header. When 'corner', search is in <KBSidebar/>. */
  searchbarPosition?: 'center' | 'corner' | null
  searchOrigin?: string
  /** Optional slot rendered before the logo (mobile menu trigger / sidebar toggle). */
  startSlot?: React.ReactNode
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
  navigationEnabled = true,
  searchbarPosition = 'center',
  searchOrigin,
  startSlot,
}: KBHeaderProps) {
  const logo = mode === 'dark' ? (logoDark ?? logoLight) : (logoLight ?? logoDark)
  const showNav = navigationEnabled && navigation && navigation.length > 0
  return (
    <header
      className={cn(
        'sticky top-[var(--kb-top-offset,0px)] z-30 border-b border-[var(--kb-border)] bg-[var(--kb-surface-bg)] px-4 py-3 backdrop-blur',
        'data-[kb-theme=bold]:border-b-2 data-[kb-theme=bold]:border-[var(--kb-fg)]'
      )}>
      <div className='mx-auto flex w-full max-w-7xl items-center gap-4'>
        <div className='flex items-center gap-2'>
          {startSlot}
          <Link
            href={homeHref}
            className='inline-flex items-center gap-2 font-semibold text-[var(--kb-fg)] no-underline'>
            {logo ? (
              <img src={logo} alt={title} className='h-7 w-auto' />
            ) : (
              <span className='text-base'>{title}</span>
            )}
          </Link>
        </div>

        {searchbarPosition === 'center' ? (
          <div className='hidden flex-1 justify-center @kb-md:flex'>
            <div className='w-full max-w-[480px]'>
              <KBSearchInput searchOrigin={searchOrigin ?? ''} basePath={basePath} />
            </div>
          </div>
        ) : (
          <div className='flex-1' />
        )}

        <nav className='flex items-center gap-2 @kb-md:gap-4'>
          {showNav
            ? navigation?.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className='hidden text-sm text-[var(--kb-fg)]/85 no-underline hover:text-[var(--kb-primary)] hover:opacity-100 @kb-md:inline'
                  prefetch={false}>
                  {link.label}
                </Link>
              ))
            : null}
          {searchbarPosition === 'center' ? (
            <KBSearchInput
              variant='icon'
              searchOrigin={searchOrigin ?? ''}
              basePath={basePath}
              className='@kb-md:hidden'
            />
          ) : null}
          {showMode ? <KBModeToggle kbId={kbId} initialMode={mode} /> : null}
        </nav>
      </div>
    </header>
  )
}
