// apps/web/src/components/money/ui/public-document/public-document-shell.tsx

// Shared chrome for public, unauthenticated customer-facing documents (quote acceptance,
// invoice pay) — the SimpleLayout dark ColorfulBg look (meteors + mountains-night + grid)
// with a centered Logo header. `SimpleLayout` itself (`~/components/layouts/simple-layout`)
// can't be reused directly here: its footer (`LayoutFooter`) unconditionally calls
// `useDehydratedOrganizations`/`useOrganizationIdContext`, which throw outside the
// `(protected)`/`(auth)` provider tree — the `(public)` route group has neither provider.
// This recomposes the same ColorfulBg + centered-Logo header markup, minus the
// account-scoped footer (nothing to link a public visitor to: no dashboard, no org switcher).

import type { ReactNode } from 'react'
import { ColorfulBg } from '~/components/global/login/colorful-bg'
import { Logo } from '~/components/global/login/logo'

interface PublicDocumentShellProps {
  children: ReactNode
}

export function PublicDocumentShell({ children }: PublicDocumentShellProps) {
  return (
    // Solid deep-navy base behind ColorfulBg: its mountains-night image mask fades out toward
    // the bottom, and unlike the one-viewport login page a document can grow taller than the
    // image — without this the below-the-fold area falls through to the white body background
    // and the translucent white/NN text becomes unreadable.
    <div className='relative overflow-hidden bg-[#050e24]'>
      <ColorfulBg>
        <div className='absolute pointer-events-none inset-0 bg-gradient-to-br from-primary/20 to-secondary/20 blur-lg opacity-50' />
        <div className='flex min-h-screen flex-col'>
          <header className='sticky top-0 z-50 w-full'>
            <div className='container flex h-16 items-center justify-center'>
              <Logo />
            </div>
          </header>
          <main className='flex flex-1 flex-col items-center px-4 py-10 sm:px-8'>
            <div className='w-full max-w-2xl'>{children}</div>
          </main>
        </div>
      </ColorfulBg>
    </div>
  )
}
