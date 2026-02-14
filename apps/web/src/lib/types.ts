import type { UserEntity as User } from '@auxx/database/models'
import type { gmail_v1 } from 'googleapis'
import { z } from 'zod'

/**
 * Utility type to expand/flatten type definitions for better IDE visibility.
 * Forces TypeScript to show all properties instead of type references.
 */
export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

/**
 * Recursively expands nested object types for full IDE visibility.
 * Use this when you need to see the complete structure of deeply nested types.
 */
export type DeepExpand<T> = T extends object
  ? T extends infer O
    ? { [K in keyof O]: DeepExpand<O[K]> }
    : never
  : T

export const emailAddressSchema = z.object({ name: z.string(), address: z.string() })
export type MessageWithPayload = gmail_v1.Schema$Message & {
  payload: gmail_v1.Schema$MessagePart
}
export interface EmailMessage {
  id: string
  threadId: string
  createdTime: number
  historyId?: string
  lastModifiedTime?: string
  sentAt: string
  receivedAt: number
  internetMessageId: string
  subject: string
  keywords: string[]
  from: EmailAddress
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  replyTo: EmailAddress[]
  hasAttachments: boolean
  textHtml?: string
  textPlain?: string
  snippet?: string
  attachments: EmailAttachment[]
  inReplyTo?: string
  references?: string
  threadIndex?: string
  internetHeaders: EmailHeader[]
  // nativeProperties: Record<string, string>
  folderId?: string
  labelIds: string[]
}
export type EmailForAction = Pick<
  EmailMessage,
  | 'threadId'
  | 'id'
  | 'to'
  | 'from'
  | 'replyTo'
  | 'cc'
  | 'receivedAt'
  | 'textHtml'
  | 'textPlain'
  | 'subject'
  | 'snippet'
  | 'internetHeaders'
  | 'internetMessageId'
  | 'sentAt'
>
export type UserBasic = Pick<User, 'id' | 'email'>
export interface EmailAddress {
  name?: string
  address: string
  raw?: string
}
export interface EmailAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  inline: boolean
  contentId?: string
  content?: string
  contentLocation?: string
}
export interface EmailHeader {
  name: string
  value: string
}
