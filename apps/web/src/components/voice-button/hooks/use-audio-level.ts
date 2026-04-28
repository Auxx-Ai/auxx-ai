// apps/web/src/components/voice-button/hooks/use-audio-level.ts
'use client'

import { useEffect, useRef } from 'react'

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

/**
 * Mic-level meter driven by an externally-owned `MediaStream`.
 *
 * Pass the live stream from `useVoiceRecorder` (or any other source) and read
 * the smoothed 0–1 level from `levelRef.current`. The hook attaches an
 * `AnalyserNode` to the stream while it is non-null and tears it down when
 * the stream changes or the component unmounts. It does **not** open the
 * microphone itself — keep stream ownership with the recorder.
 */
export function useAudioLevel(stream: MediaStream | null) {
  const levelRef = useRef(0)

  useEffect(() => {
    if (!stream) {
      levelRef.current = 0
      return
    }

    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
    if (!Ctor) return

    const ctx = new Ctor()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.4
    ctx.createMediaStreamSource(stream).connect(analyser)

    // Time-domain RMS is far more responsive to voice than averaging the full
    // frequency spectrum (where voice-band bins get diluted by ~420 silent bins).
    const data = new Uint8Array(analyser.fftSize)
    let raf = 0
    let logCounter = 0
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sumSquares += v * v
      }
      const rms = Math.sqrt(sumSquares / data.length)
      // RMS only — peak detection makes the meter twitchy at the syllable
      // level. Subtract a small noise floor and apply a heavy multiplier to
      // compensate for the aggressive AGC/noise-suppression that comes with
      // the default `audio: true` constraints.
      const norm = Math.min(1, Math.max(0, (rms - 0.003) * 25))
      // Attack/release envelope: rise fast when speech starts so the orb feels
      // alive, decay slow so it doesn't shake between syllables. Standard
      // audio-meter pattern.
      const factor = norm > levelRef.current ? 0.25 : 0.04
      levelRef.current += (norm - levelRef.current) * factor
      // Log every ~10 frames (~6 Hz) to keep the console readable while testing.
      logCounter = (logCounter + 1) % 10
      if (logCounter === 0) {
        // eslint-disable-next-line no-console
        console.log('[useAudioLevel]', {
          rms: rms.toFixed(3),
          norm: norm.toFixed(3),
          level: levelRef.current.toFixed(3),
        })
      }
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ctx.close()
      levelRef.current = 0
    }
  }, [stream])

  return levelRef
}
