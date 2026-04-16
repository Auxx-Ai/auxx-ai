// apps/web/src/components/video-player/player-mode-context.tsx
'use client'

import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react'
import type { PlayerControls, PlayerMode } from './types'

interface PlayerModeState {
  mode: PlayerMode
  setMode: React.Dispatch<React.SetStateAction<PlayerMode>>
  controls: PlayerControls
}

const PlayerModeCtx = createContext<PlayerModeState>({
  mode: 'regular',
  setMode: () => {},
  controls: { toggleMiniPlayer: true, pictureInPicture: true },
})

export function usePlayerMode() {
  return useContext(PlayerModeCtx)
}

interface PlayerModeProviderProps {
  mode: PlayerMode
  controls: PlayerControls
  isFullscreen: boolean
  children: React.ReactNode
}

export function PlayerModeProvider({
  mode: initialMode,
  controls,
  isFullscreen,
  children,
}: PlayerModeProviderProps) {
  const [mode, setMode] = useState<PlayerMode>(initialMode)

  // If mini-player toggle is disabled, stay in sync with the prop.
  useLayoutEffect(() => {
    if (!controls.toggleMiniPlayer) {
      setMode(initialMode)
    }
  }, [initialMode, controls.toggleMiniPlayer])

  // Fullscreen always forces regular mode.
  const effectiveMode: PlayerMode = isFullscreen ? 'regular' : mode

  const effectiveControls = useMemo<PlayerControls>(
    () => ({
      toggleMiniPlayer: controls.toggleMiniPlayer && !isFullscreen,
      pictureInPicture: controls.pictureInPicture,
    }),
    [controls.toggleMiniPlayer, controls.pictureInPicture, isFullscreen]
  )

  const value = useMemo(
    () => ({ mode: effectiveMode, setMode, controls: effectiveControls }),
    [effectiveMode, effectiveControls]
  )

  return <PlayerModeCtx.Provider value={value}>{children}</PlayerModeCtx.Provider>
}
