// apps/web/src/components/video-player/video-player-context.tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import type ReactPlayer from 'react-player'
import type { StoreApi, UseBoundStore } from 'zustand'
import { useStore } from 'zustand'
import type { VideoPlayerStore } from './store'
import { getOrCreateStore } from './store'
import type { Chapter, HighlightedRange } from './types'
import { roundTime } from './utils'

// ── Store context ────────────────────────────────────────────────

const StoreContext = createContext<UseBoundStore<StoreApi<VideoPlayerStore>> | null>(null)

export function useVideoPlayerStore(): UseBoundStore<StoreApi<VideoPlayerStore>>
export function useVideoPlayerStore<T>(selector: (s: VideoPlayerStore) => T): T
export function useVideoPlayerStore<T>(selector?: (s: VideoPlayerStore) => T) {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useVideoPlayerStore must be used within <VideoPlayerProvider>')
  if (selector) return useStore(store, selector)
  return store
}

// ── Player ref + source context ──────────────────────────────────

interface PlayerContext {
  player: React.RefObject<ReactPlayer | null>
  url: string
  previewThumbnailUrl?: string
  thumbnailStoryboardUrl?: string
  lazyLoadVideo: boolean
  chapters?: Chapter[]
  progressInterval: number
}

const PlayerCtx = createContext<PlayerContext | null>(null)

export function usePlayerContext() {
  const ctx = useContext(PlayerCtx)
  if (!ctx) throw new Error('usePlayerContext must be used within <VideoPlayerProvider>')
  return ctx
}

// ── Actions hook ─────────────────────────────────────────────────

export function useVideoPlayerActions() {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useVideoPlayerActions must be used within <VideoPlayerProvider>')
  const { player } = usePlayerContext()

  const play = useCallback(() => {
    const s = store.getState()
    if (!s.ready) {
      store.setState({ playRequested: true, videoLoadRequested: true })
      return
    }
    store.setState({ playing: true })
  }, [store])

  const pause = useCallback(() => {
    store.setState({ playing: false, playRequested: false })
  }, [store])

  const seekTo = useCallback(
    (time: number) => {
      const s = store.getState()
      if (!s.ready) {
        store.setState({ pendingSeek: time, videoLoadRequested: true })
        return
      }
      const t = roundTime(time)
      store.setState({ seeking: true, played: t })
      player.current?.seekTo(t, 'seconds')
      store.setState({ seeking: false })
    },
    [store, player]
  )

  const seekForward = useCallback(() => {
    const s = store.getState()
    const duration = s.duration
    if (!s.ready) {
      const t = roundTime(Math.min(s.played + 10, duration > 0 ? duration : s.played + 10))
      store.setState({ pendingSeek: t, videoLoadRequested: true })
      return
    }
    const current = player.current?.getCurrentTime() ?? s.played
    const t = roundTime(Math.min(current + 10, duration))
    store.setState({ seeking: true, played: t })
    player.current?.seekTo(t, 'seconds')
    store.setState({ seeking: false })
  }, [store, player])

  const seekBackward = useCallback(() => {
    const s = store.getState()
    if (!s.ready) {
      const t = roundTime(Math.max(0, s.played - 10))
      store.setState({ pendingSeek: t, videoLoadRequested: true })
      return
    }
    const current = player.current?.getCurrentTime() ?? s.played
    const t = roundTime(Math.max(current - 10, 0))
    store.setState({ seeking: true, played: t })
    player.current?.seekTo(t, 'seconds')
    store.setState({ seeking: false })
  }, [store, player])

  const toggleFullscreen = useCallback(() => {
    const container = document.querySelector('.react-player-container')
    if (!container) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      container.requestFullscreen()
    }
  }, [])

  const setPlaybackRate = useCallback(
    (rate: number) => store.setState({ playbackRate: rate }),
    [store]
  )

  const setHighlightedRanges = useCallback(
    (ranges: HighlightedRange[]) => {
      const duration = store.getState().duration
      store.getState().setHighlightedRanges(ranges, duration)
    },
    [store]
  )

  return useMemo(
    () => ({
      play,
      pause,
      seekTo,
      seekForward,
      seekBackward,
      toggleFullscreen,
      setPlaybackRate,
      setHighlightedRanges,
    }),
    [
      play,
      pause,
      seekTo,
      seekForward,
      seekBackward,
      toggleFullscreen,
      setPlaybackRate,
      setHighlightedRanges,
    ]
  )
}

// ── Provider ─────────────────────────────────────────────────────

interface VideoPlayerProviderProps {
  videoId: string
  sourceUrl: string
  previewThumbnailUrl?: string
  thumbnailStoryboardUrl?: string
  lazyLoadVideo?: boolean
  chapters?: Chapter[]
  children: React.ReactNode
}

export function VideoPlayerProvider({
  videoId,
  sourceUrl,
  previewThumbnailUrl,
  thumbnailStoryboardUrl,
  lazyLoadVideo = false,
  chapters,
  children,
}: VideoPlayerProviderProps) {
  const store = useMemo(() => getOrCreateStore(videoId), [videoId])
  const playerRef = useRef<ReactPlayer | null>(null)

  const playerCtx = useMemo<PlayerContext>(
    () => ({
      player: playerRef,
      url: sourceUrl,
      previewThumbnailUrl,
      thumbnailStoryboardUrl,
      lazyLoadVideo,
      chapters,
      progressInterval: 200,
    }),
    [sourceUrl, previewThumbnailUrl, thumbnailStoryboardUrl, lazyLoadVideo, chapters]
  )

  // Listen for fullscreenchange on document
  useEffect(() => {
    const handler = () => {
      store.setState({ fullscreen: document.fullscreenElement !== null })
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [store])

  // Process pending seek when player becomes ready
  const ready = useStore(store, (s) => s.ready)
  const pendingSeek = useStore(store, (s) => s.pendingSeek)

  useEffect(() => {
    if (ready && pendingSeek !== undefined && playerRef.current) {
      const t = roundTime(pendingSeek)
      store.setState({ seeking: true, played: t })
      playerRef.current.seekTo(t, 'seconds')
      store.setState({ seeking: false, pendingSeek: undefined })
    }
  }, [ready, pendingSeek, store])

  // Reset atoms on unmount
  useEffect(() => {
    return () => {
      store.setState({
        ready: false,
        playing: false,
        seeking: false,
        played: 0,
        duration: 0,
        videoLoadRequested: false,
        playRequested: false,
        pendingSeek: undefined,
        isInitialLoading: true,
      })
    }
  }, [store])

  return (
    <StoreContext.Provider value={store}>
      <PlayerCtx.Provider value={playerCtx}>{children}</PlayerCtx.Provider>
    </StoreContext.Provider>
  )
}
