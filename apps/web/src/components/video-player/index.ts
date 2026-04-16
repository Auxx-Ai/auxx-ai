// apps/web/src/components/video-player/index.ts

export { usePlayerMode } from './player-mode-context'
export type { VideoPlayerActions, VideoPlayerState, VideoPlayerStore } from './store'
// ── Store (for advanced usage / external integration) ────────────
export { getOrCreateStore, removeStore } from './store'
// ── Types ────────────────────────────────────────────────────────
export type {
  Chapter,
  ChapterSegment,
  HighlightedRange,
  PlayerControls,
  PlayerMode,
  VideoPlayerProps,
} from './types'
// ── Utilities ────────────────────────────────────────────────────
export { clamp, formatTime, roundTime, volumeIcon } from './utils'
// ── Public API ───────────────────────────────────────────────────
export { VideoPlayer } from './video-player'
export {
  usePlayerContext,
  useVideoPlayerActions,
  useVideoPlayerStore,
} from './video-player-context'
