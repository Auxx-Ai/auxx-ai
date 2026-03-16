// packages/lib/src/providers/types.ts

/**
 * Centralized provider type definitions for consistent usage across the codebase
 * This file serves as the single source of truth for provider type mapping
 */
/**
 * Defines the capabilities of a message provider
 */
export interface ProviderCapabilities {
  // Message operations
  canSend: boolean
  canReply: boolean
  canForward: boolean
  canDraft: boolean
  canDelete: boolean
  canArchive: boolean
  canMarkSpam: boolean
  canMarkTrash: boolean
  canSearch: boolean

  // Label/Tag operations
  canApplyLabel: boolean
  canRemoveLabel: boolean
  canCreateLabel: boolean
  labelScope: 'none' | 'message' | 'thread' | 'conversation'

  // Thread operations
  canManageThreads: boolean
  canAssignThreads: boolean
  canBulkOperations: boolean

  // Attachment operations
  canAttachFiles: boolean
  maxAttachmentSize?: number // in bytes
  supportedAttachmentTypes?: string[]

  // Special features
  canScheduleSend: boolean
  canTrackOpens: boolean
  canUseTemplates: boolean
  canReact: boolean // for social media
  canShare: boolean // for social media

  // Rate limiting
  rateLimits?: {
    messagesPerMinute?: number
    messagesPerHour?: number
    messagesPerDay?: number
  }

  // Provider-specific metadata
  metadata?: Record<string, any>
}

/**
 * Channel Provider Types Enum
 * These correspond to the provider strings stored in the database
 */
export enum ChannelProviderType {
  google = 'google',
  outlook = 'outlook',
  facebook = 'facebook',
  instagram = 'instagram',
  openphone = 'openphone',
  mailgun = 'mailgun',
  sms = 'sms', // Generic SMS provider
  whatsapp = 'whatsapp', // WhatsApp Business API
  chat = 'chat', // Internal chat system
  email = 'email', // Generic email provider
  shopify = 'shopify', // Shopify integration (not a messaging provider)
  imap = 'imap', // Generic IMAP/SMTP email (self-hosted, enterprise)
}

/**
 * Message Type Categories
 * Used to categorize what type of messages each provider handles
 */
export enum MessageType {
  EMAIL = 'EMAIL',
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
  CALL = 'CALL',
  CHAT = 'CHAT',
}

/**
 * Provider to Message Type Mapping
 * Defines what message types each provider can handle
 */
export const PROVIDER_MESSAGE_TYPE_MAP: Record<ChannelProviderType, MessageType[]> = {
  [ChannelProviderType.google]: [MessageType.EMAIL],
  [ChannelProviderType.outlook]: [MessageType.EMAIL],
  [ChannelProviderType.mailgun]: [MessageType.EMAIL],
  [ChannelProviderType.facebook]: [MessageType.FACEBOOK],
  [ChannelProviderType.instagram]: [MessageType.INSTAGRAM],
  [ChannelProviderType.openphone]: [MessageType.SMS, MessageType.CALL],
  [ChannelProviderType.whatsapp]: [MessageType.WHATSAPP],
  [ChannelProviderType.sms]: [MessageType.SMS],
  [ChannelProviderType.chat]: [MessageType.CHAT],
  [ChannelProviderType.email]: [MessageType.EMAIL],
  [ChannelProviderType.shopify]: [], // Shopify is a data provider, not messaging
  [ChannelProviderType.imap]: [MessageType.EMAIL],
}

/**
 * Active Messaging Providers
 * Providers that can actually send/receive messages
 */
export const MESSAGING_PROVIDERS = [
  ChannelProviderType.google,
  ChannelProviderType.outlook,
  ChannelProviderType.mailgun,
  ChannelProviderType.facebook,
  ChannelProviderType.instagram,
  ChannelProviderType.openphone,
  ChannelProviderType.whatsapp,
  ChannelProviderType.sms,
  ChannelProviderType.chat,
  ChannelProviderType.email,
  ChannelProviderType.imap,
] as const

/**
 * Data Providers
 * Providers that provide data but don't handle messaging
 */
export const DATA_PROVIDERS = [ChannelProviderType.shopify] as const

/**
 * All Provider Types
 * Complete list of all provider types
 */
export const ALL_PROVIDERS = [...MESSAGING_PROVIDERS, ...DATA_PROVIDERS] as const

/**
 * Type guard to check if a string is a valid provider type
 */
export function isValidProviderType(provider: string): provider is ChannelProviderType {
  return Object.values(ChannelProviderType).includes(provider as ChannelProviderType)
}

/**
 * Type guard to check if a provider is a messaging provider
 */
export function isMessagingProvider(provider: ChannelProviderType): boolean {
  return MESSAGING_PROVIDERS.includes(provider as any)
}

/**
 * Type guard to check if a provider is a data provider
 */
export function isDataProvider(provider: ChannelProviderType): boolean {
  return DATA_PROVIDERS.includes(provider as any)
}

/**
 * Get message types supported by a provider
 */
export function getProviderMessageTypes(provider: ChannelProviderType): MessageType[] {
  return PROVIDER_MESSAGE_TYPE_MAP[provider] || []
}

/**
 * Get providers that support a specific message type
 */
export function getProvidersForMessageType(messageType: MessageType): ChannelProviderType[] {
  return Object.entries(PROVIDER_MESSAGE_TYPE_MAP)
    .filter(([_, types]) => types.includes(messageType))
    .map(([provider]) => provider as ChannelProviderType)
}

/**
 * Legacy type alias for backward compatibility
 * @deprecated Use ChannelProviderType enum instead
 */
export type ChannelProviderTypeString =
  | 'google'
  | 'outlook'
  | 'facebook'
  | 'instagram'
  | 'openphone'
  | 'mailgun'
  | 'sms'
  | 'whatsapp'
  | 'chat'
  | 'email'
  | 'shopify'
  | 'imap'
