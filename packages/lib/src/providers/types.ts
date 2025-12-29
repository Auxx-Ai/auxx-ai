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
 * Integration Provider Types Enum
 * These correspond to the provider strings stored in the database
 */
export enum IntegrationProviderType {
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
export const PROVIDER_MESSAGE_TYPE_MAP: Record<IntegrationProviderType, MessageType[]> = {
  [IntegrationProviderType.google]: [MessageType.EMAIL],
  [IntegrationProviderType.outlook]: [MessageType.EMAIL],
  [IntegrationProviderType.mailgun]: [MessageType.EMAIL],
  [IntegrationProviderType.facebook]: [MessageType.FACEBOOK],
  [IntegrationProviderType.instagram]: [MessageType.INSTAGRAM],
  [IntegrationProviderType.openphone]: [MessageType.SMS, MessageType.CALL],
  [IntegrationProviderType.whatsapp]: [MessageType.WHATSAPP],
  [IntegrationProviderType.sms]: [MessageType.SMS],
  [IntegrationProviderType.chat]: [MessageType.CHAT],
  [IntegrationProviderType.email]: [MessageType.EMAIL],
  [IntegrationProviderType.shopify]: [], // Shopify is a data provider, not messaging
}

/**
 * Active Messaging Providers
 * Providers that can actually send/receive messages
 */
export const MESSAGING_PROVIDERS = [
  IntegrationProviderType.google,
  IntegrationProviderType.outlook,
  IntegrationProviderType.mailgun,
  IntegrationProviderType.facebook,
  IntegrationProviderType.instagram,
  IntegrationProviderType.openphone,
  IntegrationProviderType.whatsapp,
  IntegrationProviderType.sms,
  IntegrationProviderType.chat,
  IntegrationProviderType.email,
] as const

/**
 * Data Providers
 * Providers that provide data but don't handle messaging
 */
export const DATA_PROVIDERS = [IntegrationProviderType.shopify] as const

/**
 * All Provider Types
 * Complete list of all provider types
 */
export const ALL_PROVIDERS = [...MESSAGING_PROVIDERS, ...DATA_PROVIDERS] as const

/**
 * Type guard to check if a string is a valid provider type
 */
export function isValidProviderType(provider: string): provider is IntegrationProviderType {
  return Object.values(IntegrationProviderType).includes(provider as IntegrationProviderType)
}

/**
 * Type guard to check if a provider is a messaging provider
 */
export function isMessagingProvider(provider: IntegrationProviderType): boolean {
  return MESSAGING_PROVIDERS.includes(provider as any)
}

/**
 * Type guard to check if a provider is a data provider
 */
export function isDataProvider(provider: IntegrationProviderType): boolean {
  return DATA_PROVIDERS.includes(provider as any)
}

/**
 * Get message types supported by a provider
 */
export function getProviderMessageTypes(provider: IntegrationProviderType): MessageType[] {
  return PROVIDER_MESSAGE_TYPE_MAP[provider] || []
}

/**
 * Get providers that support a specific message type
 */
export function getProvidersForMessageType(messageType: MessageType): IntegrationProviderType[] {
  return Object.entries(PROVIDER_MESSAGE_TYPE_MAP)
    .filter(([_, types]) => types.includes(messageType))
    .map(([provider]) => provider as IntegrationProviderType)
}

/**
 * Legacy type alias for backward compatibility
 * @deprecated Use IntegrationProviderType enum instead
 */
export type IntegrationProviderTypeString =
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
