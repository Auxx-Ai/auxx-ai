// apps/web/src/components/file-upload/stores/slices/entity-slice.ts

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import type { StateCreator } from 'zustand'
import type { CallbackConfig, EntityConfig, UploadStore } from '../types'

/**
 * Entity configuration slice - DEPRECATED
 * @deprecated Entity configuration is now stored at session level.
 * This slice is kept for backward compatibility only.
 * All new code should pass configuration to createSession instead.
 */
export const createEntitySlice: StateCreator<
  UploadStore,
  [['zustand/immer', never], ['zustand/devtools', never]],
  [],
  Pick<
    UploadStore,
    | 'entityConfig'
    | 'callbacks'
    | 'setEntityConfig'
    | 'setCallbacks'
    | 'triggerCallback'
    | 'showSuccessToast'
    | 'showErrorToast'
  >
> = (set, get) => ({
  // DEPRECATED: Entity configuration state
  // Kept for backward compatibility - use session-scoped config instead
  entityConfig: null,
  callbacks: {},

  /**
   * @deprecated Use session-scoped configuration instead.
   * Pass entityType and entityId to createSession.
   */
  setEntityConfig: (config: EntityConfig) => {
    console.warn(
      'setEntityConfig is deprecated. Configuration should be passed to createSession instead.'
    )
    set((state) => {
      state.entityConfig = config
    })
  },

  /**
   * @deprecated Use session-scoped callbacks instead.
   * Pass callbacks to createSession.
   */
  setCallbacks: (callbacks: CallbackConfig) => {
    console.warn('setCallbacks is deprecated. Callbacks should be passed to createSession instead.')
    set((state) => {
      state.callbacks = { ...state.callbacks, ...callbacks }
    })
  },

  /**
   * Trigger appropriate callback based on event type
   * First checks session callbacks, then falls back to global (deprecated)
   */
  triggerCallback: (type: 'complete' | 'error' | 'progress', data: any) => {
    // Try session callbacks first
    const activeSessionId = get().activeSessionId
    const session = activeSessionId ? get().sessions[activeSessionId] : null
    const sessionCallbacks = session?.callbacks || {}

    // Fall back to global callbacks (deprecated)
    const globalCallbacks = get().callbacks
    const callbacks = { ...globalCallbacks, ...sessionCallbacks }

    switch (type) {
      case 'complete':
        if (callbacks.onComplete) {
          try {
            callbacks.onComplete(data)
          } catch (error) {
            console.error('Error in onComplete callback:', error)
          }
        }
        break

      case 'error':
        if (callbacks.onError) {
          try {
            callbacks.onError(data)
          } catch (error) {
            console.error('Error in onError callback:', error)
          }
        }
        break

      case 'progress':
        if (callbacks.onProgress) {
          try {
            callbacks.onProgress(data)
          } catch (error) {
            console.error('Error in onProgress callback:', error)
          }
        }
        break
    }
  },

  /**
   * Show success toast notification
   */
  showSuccessToast: (title: string, description: string) => {
    toastSuccess({ title, description })
  },

  /**
   * Show error toast notification
   */
  showErrorToast: (title: string, description: string) => {
    toastError({ title, description })
  },
})
