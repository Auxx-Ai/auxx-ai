// apps/web/src/components/voice-button/ui/voice-input-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Iridescence } from '@auxx/ui/components/iridescence'
import { toastError } from '@auxx/ui/components/toast'
import { Loader2, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAudioLevel } from '../hooks/use-audio-level'
import { useVoiceRecorder } from '../hooks/use-voice-recorder'

interface VoiceInputButtonProps {
  /** Called with the transcribed text when the recording finishes processing. */
  onTranscribed: (text: string) => void
  /** Disable starting a new recording (e.g. while another AI op is in progress). */
  disabled?: boolean
  /** Source label for usage tracking. */
  source?: string
  /**
   * When true, opens the mic and shows the orb but skips MediaRecorder and the
   * transcribe API call. For UI testing only.
   */
  testMode?: boolean
}

export function VoiceInputButton({
  onTranscribed,
  disabled,
  source = 'compose',
  testMode,
}: VoiceInputButtonProps) {
  const { state, start, stop, stream } = useVoiceRecorder({
    onTranscribed,
    onError: (err) => toastError({ title: 'Voice input failed', description: err.message }),
    source,
    testMode,
  })
  const levelRef = useAudioLevel(stream)

  return (
    <>
      {state === 'transcribing' ? (
        <Button variant='ghost' size='sm' disabled>
          <Loader2 className='animate-spin' />
          Transcribing…
        </Button>
      ) : state === 'recording' ? (
        <Button variant='ghost' size='sm' onClick={stop} className='text-red-600'>
          <Square className='animate-pulse' />
        </Button>
      ) : (
        <Button
          variant='ghost'
          size='sm'
          onClick={start}
          disabled={disabled || state === 'error'}
          title='Dictate'>
          <Mic />
        </Button>
      )}

      {/* {state === 'recording' && <RecordingOrb levelRef={levelRef} onStop={stop} />} */}
    </>
  )
}

function RecordingOrb({ levelRef, onStop }: { levelRef: { current: number }; onStop: () => void }) {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    let raf = 0
    const update = () => {
      // levelRef is already smoothed via attack/release in the hook — just
      // mirror it lightly into React state.
      setLevel((prev) => prev + (levelRef.current - prev) * 0.7)
      raf = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(raf)
  }, [levelRef])

  const amplitude = 0.18 + level * 1.7
  const speed = Math.min(2, 0.75 + level * 0.5)
  const scale = 1 + level * 0.35
  const glowOpacity = Math.min(1, 0.25 + level * 2.45)

  // Trace what the orb is actually receiving. Throttled to ~6 Hz.
  const logRef = useRef(0)
  if (++logRef.current % 10 === 0) {
    // eslint-disable-next-line no-console
    console.log('[orb]', {
      level: level.toFixed(3),
      speed: speed.toFixed(3),
      scale: scale.toFixed(3),
      glow: glowOpacity.toFixed(3),
    })
  }

  return (
    <button
      type='button'
      onClick={onStop}
      aria-label='Stop recording'
      title='Stop recording'
      className='-translate-x-1/2 fixed bottom-10 left-1/2 z-50 aspect-square w-32'>
      <div
        className='absolute inset-0 rounded-full bg-blue-500 blur-[80px]'
        style={{ opacity: glowOpacity }}
      />
      <div
        className='relative h-full w-full overflow-hidden rounded-full bg-blue-950 shadow-[0_0_60px_rgba(58,108,255,0.45)]'
        style={{ transform: `scale(${scale})`, transition: 'transform 0.12s ease-out' }}>
        <Iridescence amplitude={amplitude} speed={speed} color={[0.3, 0.6, 1]} mouseReact={false} />
      </div>
    </button>
  )
}
