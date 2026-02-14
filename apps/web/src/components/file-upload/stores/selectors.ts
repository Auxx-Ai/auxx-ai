// apps/web/src/components/file-upload/stores/selectors.ts

import { calculateOverallProgress, calculateQueueStats } from '../utils'
import type { FileState, SessionState, UploadStore } from './types'

/**
 * Optimized selectors to prevent unnecessary re-renders
 * Use these for specific data slicing in components
 */

// File selectors
export const selectFile =
  (fileId: string) =>
  (state: UploadStore): FileState | undefined =>
    state.files[fileId]

export const selectFileProgress =
  (fileId: string) =>
  (state: UploadStore): number =>
    state.files[fileId]?.progress ?? 0

export const selectFileStatus =
  (fileId: string) =>
  (state: UploadStore): FileState['status'] =>
    state.files[fileId]?.status || 'pending'

export const selectSession =
  (sessionId: string) =>
  (state: UploadStore): SessionState | undefined =>
    state.sessions[sessionId]
