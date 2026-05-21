// apps/web/src/components/mail/chat-composer/types.ts

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
}
