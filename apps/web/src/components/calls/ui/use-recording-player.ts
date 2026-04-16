// apps/web/src/components/calls/ui/use-recording-player.ts

import { create } from 'zustand'

interface RecordingPlayerState {
  /** Current video playback time in milliseconds */
  currentTimeMs: number
  /** Update the current playback time (called from video timeupdate) */
  setCurrentTimeMs: (ms: number) => void
  /** Seek the video to a specific time — registered by the video element */
  seekTo: ((ms: number) => void) | null
  /** Register the seekTo function (called when video element mounts) */
  registerSeekTo: (fn: (ms: number) => void) => void
  /** Unregister seekTo (called when video element unmounts) */
  unregisterSeekTo: () => void
}

export const useRecordingPlayer = create<RecordingPlayerState>((set) => ({
  currentTimeMs: 0,
  setCurrentTimeMs: (ms) => set({ currentTimeMs: ms }),
  seekTo: null,
  registerSeekTo: (fn) => set({ seekTo: fn }),
  unregisterSeekTo: () => set({ seekTo: null }),
}))
