// apps/web/src/components/video-player/store.ts

import { create } from 'zustand'
import type { HighlightedRange } from './types'
import { loadPersistedVolume, persistVolume } from './utils'

export interface VideoPlayerState {
  // Playback
  ready: boolean
  playing: boolean
  played: number // seconds
  duration: number // seconds
  loaded: number // buffered seconds
  seeking: boolean
  playbackRate: number

  // Audio
  muted: boolean
  volume: number

  // Display
  pip: boolean
  fullscreen: boolean
  hoveredTimePercentage: number | undefined

  // Loading
  isInitialLoading: boolean
  videoLoadRequested: boolean
  playRequested: boolean
  pendingSeek: number | undefined

  // UI
  openMenus: string[]
  highlightedRanges: HighlightedRange[]
}

export interface VideoPlayerActions {
  // Playback
  setReady: (ready: boolean) => void
  setPlaying: (playing: boolean) => void
  setPlayed: (seconds: number) => void
  setDuration: (seconds: number) => void
  setLoaded: (seconds: number) => void
  setSeeking: (seeking: boolean) => void
  setPlaybackRate: (rate: number) => void

  // Audio
  setMuted: (muted: boolean) => void
  setVolume: (volume: number) => void
  toggleMuted: () => void

  // Display
  setPip: (pip: boolean) => void
  setFullscreen: (fullscreen: boolean) => void
  setHoveredTimePercentage: (pct: number | undefined) => void

  // Loading
  setIsInitialLoading: (loading: boolean) => void
  setVideoLoadRequested: (requested: boolean) => void
  setPlayRequested: (requested: boolean) => void
  setPendingSeek: (time: number | undefined) => void
  consumePlayRequested: () => boolean

  // UI
  toggleMenu: (name: string, open: boolean) => void
  setHighlightedRanges: (ranges: HighlightedRange[], duration: number) => void

  // Reset
  reset: () => void
}

export type VideoPlayerStore = VideoPlayerState & VideoPlayerActions

function getInitialState(): VideoPlayerState {
  return {
    ready: false,
    playing: false,
    played: 0,
    duration: 0,
    loaded: 0,
    seeking: false,
    playbackRate: 1,
    muted: false,
    volume: loadPersistedVolume(),
    pip: false,
    fullscreen: false,
    hoveredTimePercentage: undefined,
    isInitialLoading: true,
    videoLoadRequested: false,
    playRequested: false,
    pendingSeek: undefined,
    openMenus: [],
    highlightedRanges: [],
  }
}

export function createVideoPlayerStore() {
  return create<VideoPlayerStore>((set, get) => ({
    ...getInitialState(),

    // --- Playback ---
    setReady: (ready) => set({ ready }),
    setPlaying: (playing) => set({ playing }),
    setPlayed: (seconds) => set({ played: seconds }),
    setDuration: (seconds) => set({ duration: seconds }),
    setLoaded: (seconds) => set({ loaded: seconds }),
    setSeeking: (seeking) => set({ seeking }),
    setPlaybackRate: (rate) => set({ playbackRate: rate }),

    // --- Audio ---
    setMuted: (muted) => set({ muted }),
    setVolume: (volume) => {
      set({ volume, muted: volume === 0 })
      persistVolume(volume)
    },
    toggleMuted: () => {
      const { muted, volume } = get()
      if (muted) {
        set({ muted: false })
        if (volume === 0) {
          set({ volume: 1 })
          persistVolume(1)
        }
      } else {
        set({ muted: true })
      }
    },

    // --- Display ---
    setPip: (pip) => set({ pip }),
    setFullscreen: (fullscreen) => set({ fullscreen }),
    setHoveredTimePercentage: (pct) => set({ hoveredTimePercentage: pct }),

    // --- Loading ---
    setIsInitialLoading: (loading) => set({ isInitialLoading: loading }),
    setVideoLoadRequested: (requested) => set({ videoLoadRequested: requested }),
    setPlayRequested: (requested) => set({ playRequested: requested }),
    setPendingSeek: (time) => set({ pendingSeek: time }),
    consumePlayRequested: () => {
      const was = get().playRequested
      set({ playRequested: false })
      return was
    },

    // --- UI ---
    toggleMenu: (name, open) =>
      set((s) => ({
        openMenus: open
          ? s.openMenus.includes(name)
            ? s.openMenus
            : [...s.openMenus, name]
          : s.openMenus.filter((m) => m !== name),
      })),
    setHighlightedRanges: (ranges, duration) => {
      if (ranges.length === 0) {
        set({ highlightedRanges: [] })
        return
      }
      const sorted = [...ranges].sort((a, b) => a.start - b.start)
      sorted[0] = { ...sorted[0], start: Math.max(0, sorted[0].start) }
      const last = sorted.length - 1
      sorted[last] = { ...sorted[last], end: Math.min(sorted[last].end, duration) }
      set({ highlightedRanges: sorted })
    },

    // --- Reset ---
    reset: () => set(getInitialState()),
  }))
}

// ── Global store cache keyed by videoId ──────────────────────────
const storeCache = new Map<string, ReturnType<typeof createVideoPlayerStore>>()

export function getOrCreateStore(videoId: string) {
  let store = storeCache.get(videoId)
  if (!store) {
    store = createVideoPlayerStore()
    storeCache.set(videoId, store)
  }
  return store
}

export function removeStore(videoId: string) {
  storeCache.delete(videoId)
}
