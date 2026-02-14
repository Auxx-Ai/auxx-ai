// packages/lib/src/messages/attachment-transformers.ts

import type { GroupedAttachmentInfo } from '../files/core/attachment-service'

/**
 * EmailAttachment-like structure for backwards compatibility
 * Used to transform new Attachment system data into the format expected by frontend
 */
export interface MessageAttachmentInfo {
  id: string
  name: string
  mimeType?: string | null
  size: number
  inline: boolean
  mediaAssetId: string | null
  attachmentOrder: number
  // Add additional fields for enhanced functionality
  title?: string | null
  role: string
  createdAt: Date
  type: 'file' | 'asset'
}

/**
 * Transform GroupedAttachmentInfo (from AttachmentService) to MessageAttachmentInfo
 * This maintains backward compatibility with existing frontend code
 */
export function transformAttachmentsForMessage(
  attachments: GroupedAttachmentInfo[]
): MessageAttachmentInfo[] {
  return attachments.map((att, index) => ({
    id: att.id,
    name: att.name || 'Untitled',
    mimeType: att.mimeType,
    size: Number(att.size || 0),
    inline: false, // Attachments are not inline by default
    mediaAssetId: att.type === 'asset' ? att.fileId : null, // For backward compatibility
    attachmentOrder: att.sort || index,
    // Enhanced fields from new system
    title: att.title,
    role: att.role,
    createdAt: att.createdAt,
    type: att.type,
  }))
}

/**
 * Transform multiple message attachments using a map
 * @param attachmentMap - Map from message ID to attachments
 * @returns Map from message ID to transformed attachments
 */
export function transformAttachmentsForMessages(
  attachmentMap: Map<string, GroupedAttachmentInfo[]>
): Map<string, MessageAttachmentInfo[]> {
  const transformedMap = new Map<string, MessageAttachmentInfo[]>()

  for (const [messageId, attachments] of attachmentMap.entries()) {
    transformedMap.set(messageId, transformAttachmentsForMessage(attachments))
  }

  return transformedMap
}
