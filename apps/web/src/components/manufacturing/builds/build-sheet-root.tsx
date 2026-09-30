// apps/web/src/components/manufacturing/builds/build-sheet-root.tsx
'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useBuildSheetStore } from './build-sheet-store'
import { useBuildsRealtime } from './use-builds-realtime'

const BuildSheet = dynamic(() => import('./build-sheet').then((m) => m.BuildSheet), {
  ssr: false,
})

/** Mount once in the app layout; `openBuildSheet` opens it from anywhere. */
export function BuildSheetRoot() {
  useBuildsRealtime()
  const isOpen = useBuildSheetStore((state) => state.frames.length > 0)
  // Stays mounted after the first open so the drawer can animate closed.
  const [loaded, setLoaded] = useState(false)
  if (isOpen && !loaded) setLoaded(true)
  return loaded ? <BuildSheet /> : null
}
