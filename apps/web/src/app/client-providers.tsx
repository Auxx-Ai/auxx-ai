// apps/web/src/app/client-providers.tsx
'use client'

import { Toaster } from '@auxx/ui/components/sonner'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type React from 'react'
import { ThemeProvider } from '~/providers/theme-provider'
import { TRPCReactProvider } from '~/trpc/react'

/**
 * ClientProviders
 * Wraps app children with all client-only providers so the server layout
 * doesn't directly import client components. This avoids RSC boundary issues
 * during server rendering and static generation.
 */
export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute='class' defaultTheme='system' enableSystem disableTransitionOnChange>
      <NuqsAdapter>
        <TRPCReactProvider>
          <Toaster />
          {children}
        </TRPCReactProvider>
      </NuqsAdapter>
    </ThemeProvider>
  )
}
