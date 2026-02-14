// apps/build/src/providers/theme-provider.tsx
'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type * as React from 'react'

/**
 * ThemeProvider wrapper for next-themes
 * Enables dark/light mode switching
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
