// apps/web/src/hooks/use-compose.ts
'use client'

import { useCallback } from 'react'
import type {
  DraftMessageType,
  EditorMode,
  EditorPresetValues,
  EditorThread,
  MessageType,
} from '~/components/mail/email-editor/types'
import { useComposeStore } from '~/components/mail/store/compose-store'

/**
 * Hook for managing floating compose editors.
 * Provides actions to open, close, dock, and undock compose instances.
 */
export function useCompose() {
  const open = useComposeStore((s) => s.open)
  const closeAction = useComposeStore((s) => s.close)
  const dockAction = useComposeStore((s) => s.dock)
  const undockAction = useComposeStore((s) => s.undock)
  const findByThread = useComposeStore((s) => s.findByThread)

  /** Open a new floating compose editor */
  const openCompose = useCallback(
    (opts?: { presetValues?: EditorPresetValues; onSendSuccess?: () => void }) => {
      return open({ mode: 'new', displayMode: 'floating', presetValues: opts?.presetValues })
    },
    [open]
  )

  /** Open a draft in a floating compose editor */
  const openDraft = useCallback(
    (draft: DraftMessageType) => {
      return open({ mode: 'draft', draft, displayMode: 'floating' })
    },
    [open]
  )

  /** Open a reply/replyAll/forward in a floating compose editor */
  const openReply = useCallback(
    (thread: EditorThread, sourceMessage: MessageType, mode: 'reply' | 'replyAll' | 'forward') => {
      return open({ mode, thread, sourceMessage, displayMode: 'floating' })
    },
    [open]
  )

  /** Open an inline editor docked into a portal target */
  const openInline = useCallback(
    (
      config: {
        mode: EditorMode
        thread?: EditorThread
        sourceMessage?: MessageType | null
        draft?: DraftMessageType | null
      },
      portalTargetId: string
    ) => {
      // Check if there's already an editor for this thread
      if (config.thread) {
        const existing = findByThread(config.thread.id)
        if (existing) {
          dockAction(existing.id, portalTargetId)
          return existing.id
        }
      }
      const id = open({ ...config, displayMode: 'inline' })
      dockAction(id, portalTargetId)
      return id
    },
    [open, findByThread, dockAction]
  )

  /** Pop out an inline editor to floating mode */
  const popOut = useCallback(
    (id: string) => {
      undockAction(id)
    },
    [undockAction]
  )

  /** Dock a floating editor back into an inline portal target */
  const dockInto = useCallback(
    (id: string, portalTargetId: string) => {
      dockAction(id, portalTargetId)
    },
    [dockAction]
  )

  return {
    openCompose,
    openDraft,
    openReply,
    openInline,
    popOut,
    dockInto,
    close: closeAction,
  }
}
