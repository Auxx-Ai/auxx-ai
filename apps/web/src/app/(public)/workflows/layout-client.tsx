// apps/web/src/app/(public)/workflows/layout-client.tsx
'use client'

import { Toaster } from '@auxx/ui/components/sonner'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import type { ReactNode } from 'react'
import { ThemeProvider } from '~/providers/theme-provider'

/**
 * Client-side providers for public workflow pages.
 * Extracted from layout.tsx to allow the parent layout to be a server component.
 */
export function PublicWorkflowClientLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute='class' defaultTheme='system' enableSystem disableTransitionOnChange>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </ThemeProvider>
  )
}
