// apps/web/src/components/video-player/video-renderer.tsx
'use client'

import { useMemo } from 'react'
import ReactPlayer from 'react-player'
import {
  usePlayerContext,
  useVideoPlayerActions,
  useVideoPlayerStore,
} from './video-player-context'

const MUX_REGEX = /stream\.mux\.com\/(?!\w+\.m3u8)(\w+)/

function useMuxProvider(url: string) {
  const isMux = MUX_REGEX.test(url)
  const config = useMemo(
    () => (isMux ? { mux: { attributes: { poster: '' } } } : undefined),
    [isMux]
  )
  return { isMux, config }
}

type LoadState = 'loading' | 'ready' | 'error'

function deriveLoadState(lazyLoadVideo: boolean, videoLoadRequested: boolean): LoadState {
  if (lazyLoadVideo && !videoLoadRequested) return 'loading'
  return 'ready'
}

function ThumbnailOverlay({ src }: { src: string }) {
  return (
    <div className='absolute inset-0 flex items-center justify-center overflow-hidden'>
      <img src={src} alt='' className='size-full object-cover' />
    </div>
  )
}

function LoadingPlaceholder({ borderRadius }: { borderRadius: string }) {
  return (
    <div
      className='aspect-video w-full'
      style={{
        background: 'var(--surface-secondary, #f3f4f6)',
        borderRadius: `${borderRadius}px`,
        border: '1px solid var(--stroke-primary, #e5e7eb)',
      }}
    />
  )
}

interface VideoRendererProps {
  borderRadius?: string
  hasBorder?: boolean
}

export function VideoRenderer({ borderRadius = '10', hasBorder = true }: VideoRendererProps) {
  const { player, url, previewThumbnailUrl, lazyLoadVideo, progressInterval } = usePlayerContext()
  const store = useVideoPlayerStore()
  const { play } = useVideoPlayerActions()
  const { config } = useMuxProvider(url)

  const playing = useVideoPlayerStore((s) => s.playing)
  const played = useVideoPlayerStore((s) => s.played)
  const pip = useVideoPlayerStore((s) => s.pip)
  const playbackRate = useVideoPlayerStore((s) => s.playbackRate)
  const volume = useVideoPlayerStore((s) => s.volume)
  const muted = useVideoPlayerStore((s) => s.muted)
  const isInitialLoading = useVideoPlayerStore((s) => s.isInitialLoading)
  const videoLoadRequested = useVideoPlayerStore((s) => s.videoLoadRequested)
  const seeking = useVideoPlayerStore((s) => s.seeking)

  const loadState = deriveLoadState(lazyLoadVideo, videoLoadRequested)

  const onReady = () => {
    const s = store.getState()
    s.setReady(true)
    if (s.consumePlayRequested()) {
      s.setPlaying(true)
    }
  }

  const onPlay = () => store.getState().setPlaying(true)
  const onPause = () => store.getState().setPlaying(false)
  const onEnablePIP = () => store.getState().setPip(true)
  const onDisablePIP = () => store.getState().setPip(false)
  const onEnded = () => store.getState().setPlaying(false)

  const onProgress = ({
    playedSeconds,
    loadedSeconds,
  }: {
    playedSeconds: number
    loadedSeconds: number
  }) => {
    if (loadedSeconds > 0) store.getState().setIsInitialLoading(false)
    if (!store.getState().seeking) {
      store.getState().setPlayed(playedSeconds)
      store.getState().setLoaded(loadedSeconds)
    }
  }

  const onDuration = (d: number) => store.getState().setDuration(d)
  const onPlaybackRateChange = (rate: number) => store.getState().setPlaybackRate(rate)

  const showThumbnail = !playing && played === 0 && previewThumbnailUrl && loadState !== 'error'

  return (
    <div className='relative min-h-0'>
      {loadState === 'ready' && (
        <>
          <ReactPlayer
            ref={player}
            url={url}
            width='100%'
            height='100%'
            className='react-player'
            controls={false}
            playing={playing}
            progressInterval={progressInterval}
            pip={pip}
            loop={false}
            playbackRate={playbackRate}
            volume={volume}
            muted={muted}
            onReady={onReady}
            onPlay={onPlay}
            onPause={onPause}
            onEnablePIP={onEnablePIP}
            onDisablePIP={onDisablePIP}
            onPlaybackRateChange={onPlaybackRateChange}
            onEnded={onEnded}
            onProgress={onProgress}
            onDuration={onDuration}
            config={config}
            style={{
              position: 'relative',
              minHeight: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              aspectRatio: '16/9',
            }}
          />
          {isInitialLoading && !lazyLoadVideo && (
            <div className='absolute inset-0'>
              <LoadingPlaceholder borderRadius={borderRadius} />
            </div>
          )}
        </>
      )}

      {loadState === 'loading' && <LoadingPlaceholder borderRadius={borderRadius} />}

      {showThumbnail && (
        <div className='absolute inset-0'>
          <ThumbnailOverlay src={previewThumbnailUrl} />
        </div>
      )}
    </div>
  )
}
