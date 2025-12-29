// apps/web/src/components/mail/email-editor/message-file.tsx

'use client'

/**
 * MessageFile - File attachment display component for email messages
 * 
 * This component reuses the CommentFile component for consistency
 * across the application. Both comments and messages share the same
 * file display UI/UX patterns.
 */

export { CommentFile as MessageFile } from '~/components/global/comments/comment-file'
export type { CommentFileProps as MessageFileProps } from '~/components/global/comments/comment-file'