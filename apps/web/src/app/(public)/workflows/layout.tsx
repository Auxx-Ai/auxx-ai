// apps/web/src/app/(public)/workflows/layout.tsx

'use client'

import '@xyflow/react/dist/style.css'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { Toaster } from '@auxx/ui/components/sonner'
import { ThemeProvider } from '~/providers/theme-provider'

/**
 * Props for the public workflow layout
 */
interface WorkflowLayoutProps {
  children: React.ReactNode
}

/**
 * Layout for public workflow pages
 * Minimal providers - no auth required
 */
export default function PublicWorkflowLayout({ children }: WorkflowLayoutProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </ThemeProvider>
  )
}
