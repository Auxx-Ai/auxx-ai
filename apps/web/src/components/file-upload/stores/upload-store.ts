// apps/web/src/components/file-upload/stores/upload-store.ts

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { createEntitySlice } from './slices/entity-slice'
import { createFileSlice } from './slices/file-slice'
import { cleanupUploader, createEnhancedOrchestrationSlice } from './slices/orchestration-slice'
import { createUnifiedSessionSlice } from './slices/session-slice'
import { createUISlice } from './slices/ui-slice'
import type { UploadStore } from './types'

// Export cleanupUploader for use in hooks
export { cleanupUploader }

/**
 * Main upload store combining all slices
 */
export const useUploadStore = create<UploadStore>()(
  devtools(
    immer((...a) => ({
      // Combine all slices with simplified unified architecture
      ...createUnifiedSessionSlice(...a),
      ...createFileSlice(...a),
      ...createUISlice(...a),
      ...createEnhancedOrchestrationSlice(...a),
      ...createEntitySlice(...a),
    }))
  )
)

// Cleanup function to call on app unmount/page unload
export const cleanupUploadStore = () => {
  useUploadStore.getState().cleanup()
}

// Prevent multiple beforeunload listeners (HMR protection)
declare global {
  interface Window {
    __uploadStoreUnloadHookAdded?: boolean
  }
}

if (typeof window !== 'undefined' && !window.__uploadStoreUnloadHookAdded) {
  window.addEventListener('beforeunload', cleanupUploadStore)
  window.__uploadStoreUnloadHookAdded = true
}
