// apps/build/src/components/layouts/simple-layout.tsx
'use client'

import { WEBAPP_URL } from '@auxx/config/client'
import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '~/components/logo'
import { ColorfulBg } from './colorful-bg'

interface SimpleLayoutProps {
  children: ReactNode
  title?: string
  showBackToDashboard?: boolean
}

/**
 * Simple layout for subscription and organization management.
 * Lightweight header with logo and basic navigation.
 */
export function SimpleLayout({ children, title, showBackToDashboard = true }: SimpleLayoutProps) {
  const handleLogout = async () => {}

  return (
    <ColorfulBg>
      <div className='min-h-screen flex flex-col flex-1'>
        {/* Header */}
        <header className='sticky top-0 z-50 w-full'>
          <div className='container flex h-16 items-center justify-between'>
            <div className='flex items-center gap-4 mx-auto'>
              <Logo />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className='flex-1 flex min-h-0 flex-col'>{children}</main>
        <footer className='container flex items-center justify-center py-3'>
          <nav className='flex items-center gap-2'>
            {/* {showBackToDashboard && canAccessDashboard && (
              <Button variant="ghost" asChild size="sm">
                <Link href="/app/dashboard">Dashboard</Link>
              </Button>
            )} */}

            <Button variant='ghost' asChild size='sm'>
              <Link href={`${WEBAPP_URL}/organizations`}>Organizations</Link>
            </Button>

            <Button variant='ghost' asChild size='sm'>
              <Link href={'https://auxx.ai'} target='_blank' rel='noopener noreferrer'>
                Home
              </Link>
            </Button>

            <Button variant='ghost' onClick={handleLogout} size='sm'>
              Sign Out
            </Button>
          </nav>
        </footer>
      </div>
    </ColorfulBg>
  )
}
