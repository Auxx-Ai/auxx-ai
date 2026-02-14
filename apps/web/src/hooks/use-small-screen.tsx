// File: src/hooks/use-small-screen.tsx
'use client'

import { useEffect, useState } from 'react'

/**
 * Hook to detect if the current screen size is small (sm breakpoint and below)
 * Uses 640px as the breakpoint (Tailwind's sm breakpoint)
 * @returns boolean indicating if screen is small
 */
export function useIsSmallScreen(): boolean {
  const [isSmall, setIsSmall] = useState(false)

  useEffect(() => {
    const checkScreenSize = () => {
      setIsSmall(window.innerWidth < 640) // 640px = sm breakpoint in Tailwind
    }

    // Check initial screen size
    checkScreenSize()

    // Add event listener for screen size changes
    window.addEventListener('resize', checkScreenSize)

    // Cleanup event listener on component unmount
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  return isSmall
}
