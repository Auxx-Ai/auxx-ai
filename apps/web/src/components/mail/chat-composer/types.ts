// apps/web/src/components/mail/chat-composer/types.ts

import type React from 'react'
import type { EditorThread } from '../email-editor/types'

export interface ChatComposerProps {
  thread: EditorThread
  onClose: () => void
  onSendSuccess: () => void
  isDialogMode?: boolean
  onPopOut?: () => void
  onMinimize?: () => void
  onDockBack?: () => void
  instanceId?: string
  /**
   * Hide the composer's built-in header bar AND drop the gray frame/shadow so the composer
   * blends into a wrapping panel. Used when a wrapper (e.g. ChatPanel) owns those visuals.
   */
  hideHeader?: boolean
  /** When set, the header's title region becomes the drag handle (spread on a div). */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}
