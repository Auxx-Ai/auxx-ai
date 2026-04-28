// apps/web/src/components/voice-button/hooks/use-voice-recorder.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceRecorderState = 'idle' | 'recording' | 'transcribing' | 'error'

interface UseVoiceRecorderOptions {
  /** Called with the transcribed text once the server returns it. */
  onTranscribed: (text: string) => void
  /** Called for any failure path (mic permission, network, server). */
  onError?: (err: Error) => void
  /** Source label for usage tracking. Default: 'compose'. */
  source?: string
  /** Optional language hint (ISO 639-1). Omit to let the provider auto-detect. */
  language?: string
  /** Auto-stop after this many ms to keep audio under the 25MB cap. Default 60s. */
  maxDurationMs?: number
  /**
   * When true, opens the mic stream and toggles `recording` state for visualization
   * but skips MediaRecorder and the transcribe API call. Useful for UI testing.
   */
  testMode?: boolean
}

/**
 * MediaRecorder-based dictation hook. Records audio in the browser, POSTs the blob to
 * /api/speech/transcribe, and yields the transcribed text via `onTranscribed`.
 *
 * Browser support:
 *   - Chrome/Edge/Firefox: webm/opus
 *   - Safari: mp4
 * Falls back to the browser's default mimeType if neither is supported.
 */
export function useVoiceRecorder({
  onTranscribed,
  onError,
  source = 'compose',
  language,
  maxDurationMs = 60_000,
  testMode = false,
}: UseVoiceRecorderOptions) {
  const [state, setState] = useState<VoiceRecorderState>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const releaseStream = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    setStream(null)
  }, [])

  useEffect(() => () => releaseStream(), [releaseStream])

  const stop = useCallback(() => {
    if (testMode) {
      releaseStream()
      setState('idle')
      return
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [testMode, releaseStream])

  const start = useCallback(async () => {
    if (state !== 'idle') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setStream(stream)

      if (testMode) {
        setState('recording')
        timeoutRef.current = setTimeout(() => stop(), maxDurationMs)
        return
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        chunksRef.current = []
        releaseStream()

        if (blob.size === 0) {
          setState('idle')
          return
        }

        setState('transcribing')
        try {
          const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
          const fd = new FormData()
          fd.append('audio', blob, `recording.${ext}`)
          if (language) fd.append('language', language)
          fd.append('source', source)

          const res = await fetch('/api/speech/transcribe', { method: 'POST', body: fd })
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error || `Transcription failed (${res.status})`)
          }
          const json = (await res.json()) as { text: string }
          if (json.text) onTranscribed(json.text)
          setState('idle')
        } catch (err) {
          setState('error')
          onError?.(err as Error)
          // Auto-recover so the button is usable again.
          setTimeout(() => setState('idle'), 1500)
        }
      }

      recorder.start()
      setState('recording')
      timeoutRef.current = setTimeout(() => stop(), maxDurationMs)
    } catch (err) {
      releaseStream()
      setState('error')
      onError?.(err as Error)
      setTimeout(() => setState('idle'), 1500)
    }
  }, [
    state,
    language,
    source,
    maxDurationMs,
    releaseStream,
    onTranscribed,
    onError,
    stop,
    testMode,
  ])

  return { state, start, stop, stream }
}
