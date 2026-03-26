// apps/homepage/src/components/autoplay-video.tsx

'use client'

import { useEffect, useRef } from 'react'

interface AutoplayVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  /** Play/pause based on viewport visibility. Default: true */
  playOnView?: boolean
}

/**
 * Video component that reliably autoplays on mobile browsers.
 *
 * Fixes iOS Safari's broken React `muted` JSX attribute by setting it
 * programmatically on the DOM element. Uses IntersectionObserver to
 * play only when visible and pause when offscreen.
 */
export function AutoplayVideo({ playOnView = true, ...props }: AutoplayVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { src, muted, autoPlay } = props

  // biome-ignore lint/correctness/useExhaustiveDependencies: src is needed to re-init when video source changes (tab switching)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Fix: React's muted JSX prop doesn't reliably set the DOM attribute on iOS Safari
    if (muted) {
      video.muted = true
    }

    if (!playOnView) {
      // For user-triggered videos (e.g. modal), just play immediately
      if (autoPlay) {
        video.play().catch(() => {})
      }
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      },
      { threshold: 0.25 }
    )

    observer.observe(video)

    return () => {
      observer.disconnect()
    }
  }, [src, muted, autoPlay, playOnView])

  // Destructure autoPlay and muted so they aren't passed as JSX attributes —
  // we handle both via the ref to bypass React's buggy behavior
  const { autoPlay: _, muted: __, ...rest } = props

  return <video ref={videoRef} preload='metadata' playsInline {...rest} />
}
