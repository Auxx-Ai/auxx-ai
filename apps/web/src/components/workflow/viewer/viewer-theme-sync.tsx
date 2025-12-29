// apps/web/src/components/workflow/viewer/viewer-theme-sync.tsx

'use client'

import { useEffect } from 'react'

/**
 * Props for ViewerThemeSync
 */
interface ViewerThemeSyncProps {
  theme?: 'light' | 'dark'
}

/**
 * Syncs the theme to the document body for the public workflow viewer.
 * This ensures CSS variables cascade correctly without affecting localStorage.
 */
export function ViewerThemeSync({ theme }: ViewerThemeSyncProps) {
  useEffect(() => {
    if (!theme) return

    // Add the theme class to body
    if (theme === 'dark') {
      document.body.classList.add('dark')
    } else {
      document.body.classList.remove('dark')
    }

    // Cleanup: remove dark class when component unmounts
    return () => {
      document.body.classList.remove('dark')
    }
  }, [theme])

  return null
}
