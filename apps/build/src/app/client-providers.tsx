// apps/build/src/app/client-providers.tsx
'use client'

import React from 'react'
import { ThemeProvider } from '~/providers/theme-provider'
import { TRPCReactProvider } from '~/trpc/react'
import { Toaster } from '@auxx/ui/components/sonner'

/**
 * ClientProviders
 * Wraps app children with all client-only providers so the server layout
 * doesn't directly import client components. This avoids RSC boundary issues
 * during server rendering and static generation.
 */
export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TRPCReactProvider>{children}</TRPCReactProvider>
      <Toaster />
    </ThemeProvider>
  )
}
