// apps/web/src/components/video-player/types.ts

export interface Chapter {
  start: number
  end: number
  title: string
}

export interface HighlightedRange {
  start: number
  end: number
  color: string
}

export type PlayerMode = 'regular' | 'mini' | 'mini-standalone'

export interface PlayerControls {
  toggleMiniPlayer: boolean
  pictureInPicture: boolean
}

export interface VideoPlayerProps {
  videoId: string
  sourceUrl: string
  previewThumbnailUrl?: string
  thumbnailStoryboardUrl?: string
  children?: React.ReactNode
  chapters?: Chapter[]
  mode?: PlayerMode
  controls?: Partial<PlayerControls>
  borderRadius?: string
  hasBorder?: boolean
  className?: string
  disableMotion?: boolean
  miniStandaloneControls?: React.ReactNode
  autoFocus?: boolean
  lazyLoadVideo?: boolean
}

export interface ChapterSegment extends Chapter {
  width: number
  progress: number
}
