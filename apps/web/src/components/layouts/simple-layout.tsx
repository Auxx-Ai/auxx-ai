// apps/web/src/components/layouts/simple-layout.tsx
'use client'

import type { ReactNode } from 'react'
import { Logo } from '~/components/global/login/logo'
import { ColorfulBg } from '../global/login/colorful-bg'
import { LayoutFooter } from './layout-footer'

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
  return (
    <div className='relative overflow-hidden'>
      <ColorfulBg>
        <div className='absolute pointer-events-none inset-0 bg-gradient-to-br from-primary/20 to-secondary/20 blur-lg opacity-50' />
        <div className='min-h-screen flex flex-col'>
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
          <LayoutFooter showBackToDashboard={showBackToDashboard} />
        </div>
      </ColorfulBg>
    </div>
  )
}
