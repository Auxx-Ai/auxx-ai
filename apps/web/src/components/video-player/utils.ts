// apps/web/src/components/video-player/utils.ts

/** Round to 5 decimal places to avoid floating-point drift */
export function roundTime(t: number): number {
  return Number((t + 1e-5).toFixed(5))
}

/** Format seconds as mm:ss or hh:mm:ss */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${String(h).padStart(2, '0')}:${mm}:${ss}`
  return `${mm}:${ss}`
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Volume level to icon name */
export function volumeIcon(volume: number): string {
  if (volume === 0) return 'SpeakerOff'
  if (volume < 0.4) return 'SpeakerLow'
  if (volume < 0.7) return 'SpeakerMedium'
  return 'SpeakerHigh'
}

const VOLUME_STORAGE_KEY = 'auxx:video-player-volume'

export function loadPersistedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (raw !== null) {
      const v = Number.parseFloat(raw)
      if (Number.isFinite(v) && v >= 0 && v <= 1) return v
    }
  } catch {
    // localStorage not available
  }
  return 1
}

export function persistVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
  } catch {
    // ignore
  }
}
