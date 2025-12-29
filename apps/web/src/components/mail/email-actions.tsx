// src/components/mail/email-actions.tsx
import { RouterOutputs } from '~/trpc/react'

type MessageType = RouterOutputs['thread']['getById']['messages'][number]

/**
 * Type definition for email action handlers
 */
export type EmailActions = {
  onReply: (message: MessageType) => void
  onReplyAll: (message: MessageType) => void
  onForward: (message: MessageType) => void
  onResend: (message: MessageType) => void | Promise<void>
  onMarkUnread: (message: MessageType) => void | Promise<void>
  onDelete: (message: MessageType) => void | Promise<void>
  onDownload: (message: MessageType) => void | Promise<void>
  onPrint: (message: MessageType) => void
  onCopyId: (message: MessageType) => void | Promise<void>
  onViewSource: (message: MessageType) => void
}

/**
 * Type definition for reply box mode
 */
export type ReplyBoxMode = 'reply' | 'reply-all' | 'forward'

// Note: Email actions are now implemented directly in ThreadProvider
// This file only exports the type definitions for consistency
