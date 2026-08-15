// packages/lib/src/providers/provider-capabilities.ts

// `IntegrationProviderType` from `@auxx/database/enums` is a const *object* — usable
// for keys/values only. `ChannelProviderType` (providers/types.ts) is the matching
// union *type*, aliased onto the same enum object.
import { IntegrationProviderType } from '@auxx/database/enums'
import type { ChannelProviderType, ProviderCapabilities } from './types'

export type { ProviderCapabilities } from './types'
/**
 * Provider capability presets — the **runtime** matrix the ChannelProvider
 * implementations and the send path read. Server-only.
 *
 * Two fields here have a counterpart in `channels/capabilities.ts`
 * (`PlatformCapabilities`), which is the client-safe map the composer UI and
 * the kopilot catalog read:
 *
 * - `supportsRichText` ↔ `richText`
 * - `canAttachFiles`   ↔ `attachments`
 *
 * **`channels/capabilities.ts` is the authority for anything the UI decides**
 * (which affordances to render, what body shape to submit). These two stay
 * because the send path is server-side and must not import the UI map's
 * concerns; keep them in sync by hand — the maps are deliberately NOT merged
 * (merging drags `rateLimits`, `maxAttachmentSize` and ~30 other runtime
 * fields into the browser bundle).
 */
export const PROVIDER_CAPABILITIES: Record<ChannelProviderType, ProviderCapabilities> = {
  [IntegrationProviderType.google]: {
    supportsPersonalConnection: true,
    supportsBidirectionalStatusSync: true,
    supportsMailFilters: true,
    // Gmail capabilities
    canSend: true,
    canReply: true,
    canForward: true,
    canDraft: true,
    canDelete: true,
    canArchive: true,
    canMarkSpam: true,
    canMarkTrash: true,
    canSearch: true,
    canApplyLabel: true,
    canRemoveLabel: true,
    canCreateLabel: true,
    labelScope: 'thread',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: true,
    canAttachFiles: true,
    maxAttachmentSize: 25 * 1024 * 1024, // 25MB
    canScheduleSend: false,
    canTrackOpens: false,
    canUseTemplates: true,
    canReact: false,
    canShare: false,
    requiresSubject: true,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: true,
    triggersPostSendSync: true,
    requiresSendReconciliation: true,
    supportsRichText: true,
  },
  [IntegrationProviderType.facebook]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: false,
    // Facebook Messenger capabilities
    canSend: true,
    canReply: true,
    canForward: false,
    canDraft: false, // Real-time messaging
    canDelete: false,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: false,
    canSearch: true,
    canApplyLabel: true,
    canRemoveLabel: true,
    canCreateLabel: false, // Uses Facebook's label system
    labelScope: 'conversation',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: false,
    canAttachFiles: true,
    maxAttachmentSize: 10 * 1024 * 1024, // 10MB
    supportedAttachmentTypes: ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'],
    canScheduleSend: false,
    canTrackOpens: false,
    canUseTemplates: false,
    canReact: true,
    canShare: false,
    rateLimits: {
      messagesPerMinute: 200,
      messagesPerHour: 1000,
    },
    // TODO: FB DMs have no subject and use PSID identifiers — flags below match
    // today's behavior. De-emailing the FB pipeline is a separate refactor.
    requiresSubject: true,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: true,
    triggersPostSendSync: true,
    requiresSendReconciliation: true,
    supportsRichText: false,
  },
  [IntegrationProviderType.instagram]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: false,
    // Instagram Direct Message capabilities
    canSend: true,
    canReply: true,
    canForward: false,
    canDraft: false,
    canDelete: false,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: false,
    canSearch: false,
    canApplyLabel: false, // Instagram doesn't support labels
    canRemoveLabel: false,
    canCreateLabel: false,
    labelScope: 'none',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: false,
    canAttachFiles: true,
    maxAttachmentSize: 8 * 1024 * 1024, // 8MB
    supportedAttachmentTypes: ['image/jpeg', 'image/png', 'video/mp4'],
    canScheduleSend: false,
    canTrackOpens: false,
    canUseTemplates: false,
    canReact: true,
    canShare: true,
    rateLimits: {
      messagesPerMinute: 100,
      messagesPerHour: 500,
    },
    // TODO: see FB note above — Instagram DM flags match today's behavior.
    requiresSubject: true,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: true,
    triggersPostSendSync: true,
    requiresSendReconciliation: true,
    supportsRichText: false,
  },
  [IntegrationProviderType.openphone]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: false,
    // SMS capabilities (via OpenPhone or similar)
    canSend: true,
    canReply: true,
    canForward: false,
    canDraft: false,
    canDelete: false,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: false,
    canSearch: true,
    canApplyLabel: false,
    canRemoveLabel: false,
    canCreateLabel: false,
    labelScope: 'none',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: false,
    canAttachFiles: false, // SMS doesn't support attachments
    // VERIFIED CORRECT — do not "fix" this back to false. Quo has no
    // scheduled-send API, but scheduling never touches Quo: `thread.sendMessage`
    // writes a `ScheduledMessage` row and enqueues a delayed BullMQ job that
    // later calls the ordinary send path. Provider-agnostic by construction, so
    // it holds for every provider that can send at all.
    canScheduleSend: true,
    canTrackOpens: false,
    canUseTemplates: true,
    canReact: false,
    canShare: false,
    metadata: {
      // Quo accepts up to 1600 characters on `POST /v1/messages` and segments longer SMS
      // itself; 160 is the per-segment GSM limit, not the API's.
      maxMessageLength: 1600,
      supportsUnicode: true,
    },
    requiresSubject: false,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: false,
    triggersPostSendSync: false,
    requiresSendReconciliation: false,
    supportsRichText: false,
  },
  [IntegrationProviderType.mailgun]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: true,
    // Mailgun email service capabilities
    canSend: true,
    canReply: true,
    canForward: true,
    canDraft: false, // SMTP service doesn't draft
    canDelete: false,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: false,
    canSearch: false,
    canApplyLabel: false,
    canRemoveLabel: false,
    canCreateLabel: false,
    labelScope: 'none',
    canManageThreads: false,
    canAssignThreads: false,
    canBulkOperations: true,
    canAttachFiles: true,
    maxAttachmentSize: 25 * 1024 * 1024, // 25MB
    canScheduleSend: false,
    canTrackOpens: true,
    canUseTemplates: true,
    canReact: false,
    canShare: false,
    requiresSubject: true,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: true,
    triggersPostSendSync: true,
    requiresSendReconciliation: true,
    supportsRichText: true,
  },
  [IntegrationProviderType.sms]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: false,
    // Generic SMS capabilities
    canSend: true,
    canReply: true,
    canForward: false,
    canDraft: false,
    canDelete: false,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: false,
    canSearch: true,
    canApplyLabel: false,
    canRemoveLabel: false,
    canCreateLabel: false,
    labelScope: 'none',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: false,
    canAttachFiles: false, // SMS doesn't support attachments
    canScheduleSend: true,
    canTrackOpens: false,
    canUseTemplates: true,
    canReact: false,
    canShare: false,
    metadata: {
      maxMessageLength: 160,
      supportsUnicode: true,
    },
    requiresSubject: false,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: false,
    triggersPostSendSync: false,
    requiresSendReconciliation: false,
    supportsRichText: false,
  },
  [IntegrationProviderType.email]: {
    supportsPersonalConnection: true,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: true,
    // Generic email capabilities
    canSend: true,
    canReply: true,
    canForward: true,
    canDraft: true,
    canDelete: true,
    canArchive: true,
    canMarkSpam: true,
    canMarkTrash: true,
    canSearch: true,
    canApplyLabel: true,
    canRemoveLabel: true,
    canCreateLabel: true,
    labelScope: 'thread',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: true,
    canAttachFiles: true,
    maxAttachmentSize: 25 * 1024 * 1024, // 25MB
    canScheduleSend: false,
    canTrackOpens: false,
    canUseTemplates: true,
    canReact: false,
    canShare: false,
    requiresSubject: true,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: true,
    triggersPostSendSync: true,
    requiresSendReconciliation: true,
    supportsRichText: true,
  },
  [IntegrationProviderType.whatsapp]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: false,
    // WhatsApp Business API capabilities
    canSend: true,
    canReply: true,
    canForward: true,
    canDraft: false,
    canDelete: false,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: false,
    canSearch: true,
    canApplyLabel: true,
    canRemoveLabel: true,
    canCreateLabel: false,
    labelScope: 'conversation',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: false,
    canAttachFiles: true,
    maxAttachmentSize: 16 * 1024 * 1024, // 16MB
    supportedAttachmentTypes: ['image/*', 'video/*', 'audio/*', 'application/pdf'],
    canScheduleSend: false,
    canTrackOpens: true, // Read receipts
    canUseTemplates: true, // WhatsApp templates
    canReact: false,
    canShare: false,
    rateLimits: {
      messagesPerMinute: 60,
      messagesPerDay: 1000,
    },
    requiresSubject: false,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: false,
    triggersPostSendSync: false,
    requiresSendReconciliation: false,
    supportsRichText: false,
  },
  [IntegrationProviderType.chat]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: false,
    // Generic chat capabilities (internal chat system)
    canSend: true,
    canReply: true,
    canForward: false,
    canDraft: true,
    canDelete: true,
    canArchive: true,
    canMarkSpam: false,
    canMarkTrash: true,
    canSearch: true,
    canApplyLabel: true,
    canRemoveLabel: true,
    canCreateLabel: true,
    labelScope: 'thread',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: true,
    canAttachFiles: true,
    maxAttachmentSize: 50 * 1024 * 1024, // 50MB
    canScheduleSend: false,
    canTrackOpens: true,
    canUseTemplates: true,
    canReact: true,
    canShare: false,
    // Chat: visitor is encoded on the Thread, no subject, free.
    // Chat has no external state to reconcile — the provider echoes our own
    // thread id back, and reconciling would clobber thread metadata.
    requiresSubject: false,
    requiresRecipients: false,
    countsAgainstOutboundEmailsQuota: false,
    triggersPostSendSync: false,
    requiresSendReconciliation: false,
    supportsRichText: false,
  },
  [IntegrationProviderType.shopify]: {
    supportsPersonalConnection: false,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: false,
    // Shopify capabilities (not a messaging provider)
    canSend: false,
    canReply: false,
    canForward: false,
    canDraft: false,
    canDelete: false,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: false,
    canSearch: false,
    canApplyLabel: false,
    canRemoveLabel: false,
    canCreateLabel: false,
    labelScope: 'none',
    canManageThreads: false,
    canAssignThreads: false,
    canBulkOperations: false,
    canAttachFiles: false,
    canScheduleSend: false,
    canTrackOpens: false,
    canUseTemplates: false,
    canReact: false,
    canShare: false,
    metadata: {
      isDataProvider: true,
      providesOrderData: true,
      providesCustomerData: true,
    },
    requiresSubject: false,
    requiresRecipients: false,
    countsAgainstOutboundEmailsQuota: false,
    triggersPostSendSync: false,
    requiresSendReconciliation: false,
    supportsRichText: false,
  },
  [IntegrationProviderType.imap]: {
    supportsPersonalConnection: true,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: true,
    // IMAP/SMTP capabilities (self-hosted, enterprise)
    canSend: true,
    canReply: true,
    canForward: true,
    canDraft: false,
    canDelete: true,
    canArchive: false,
    canMarkSpam: false,
    canMarkTrash: true,
    canSearch: false,
    canApplyLabel: false,
    canRemoveLabel: false,
    canCreateLabel: false,
    labelScope: 'none',
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: false,
    canAttachFiles: true,
    maxAttachmentSize: 25 * 1024 * 1024, // 25MB (server-dependent)
    canScheduleSend: false,
    canTrackOpens: false,
    canUseTemplates: true,
    canReact: false,
    canShare: false,
    requiresSubject: true,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: true,
    triggersPostSendSync: true,
    requiresSendReconciliation: true,
    supportsRichText: true,
  },
  [IntegrationProviderType.outlook]: {
    supportsPersonalConnection: true,
    supportsBidirectionalStatusSync: false,
    supportsMailFilters: true,
    // Outlook/Office 365 capabilities
    canSend: true,
    canReply: true,
    canForward: true,
    canDraft: true,
    canDelete: true,
    canArchive: true,
    canMarkSpam: true,
    canMarkTrash: true,
    canSearch: true,
    canApplyLabel: true, // Categories in Outlook
    canRemoveLabel: true,
    canCreateLabel: true,
    labelScope: 'message', // Outlook applies categories to messages
    canManageThreads: true,
    canAssignThreads: true,
    canBulkOperations: true,
    canAttachFiles: true,
    maxAttachmentSize: 25 * 1024 * 1024, // 25MB
    canScheduleSend: true, // Outlook supports delayed send
    canTrackOpens: false,
    canUseTemplates: true,
    canReact: false,
    canShare: false,
    requiresSubject: true,
    requiresRecipients: true,
    countsAgainstOutboundEmailsQuota: true,
    triggersPostSendSync: true,
    requiresSendReconciliation: true,
    supportsRichText: true,
  },
}
/**
 * Helper function to check if a provider supports a specific capability
 */
// export function providerSupportsCapability(
//   providerType: IntegrationProviderType,
//   capability: keyof ProviderCapabilities
// ): boolean {
//   const capabilities = PROVIDER_CAPABILITIES[providerType]
//   if (!capabilities) return false
//   const value = capabilities[capability]
//   return typeof value === 'boolean' ? value : value !== 'none'
// }
/**
 * Helper function to get provider capabilities with defaults
 */
export function getProviderCapabilities(providerType: ChannelProviderType): ProviderCapabilities {
  return (
    PROVIDER_CAPABILITIES[providerType] || {
      // Default minimal capabilities
      supportsPersonalConnection: false,
      supportsBidirectionalStatusSync: false,
      supportsMailFilters: false,
      canSend: false,
      canReply: false,
      canForward: false,
      canDraft: false,
      canDelete: false,
      canArchive: false,
      canMarkSpam: false,
      canMarkTrash: false,
      canSearch: false,
      canApplyLabel: false,
      canRemoveLabel: false,
      canCreateLabel: false,
      labelScope: 'none',
      canManageThreads: false,
      canAssignThreads: false,
      canBulkOperations: false,
      canAttachFiles: false,
      canScheduleSend: false,
      canTrackOpens: false,
      canUseTemplates: false,
      canReact: false,
      canShare: false,
      requiresSubject: false,
      requiresRecipients: false,
      countsAgainstOutboundEmailsQuota: false,
      triggersPostSendSync: false,
      requiresSendReconciliation: false,
      supportsRichText: false,
    }
  )
}
/**
 * Check if an action type is supported by a provider
 */
// export function isActionSupportedByProvider(
//   actionType: string,
//   providerType: IntegrationProviderType
// ): boolean {
//   const capabilities = getProviderCapabilities(providerType)
//   // Map action types to capabilities
//   const actionCapabilityMap: Record<string, keyof ProviderCapabilities> = {
//     SEND_MESSAGE: 'canSend',
//     REPLY: 'canReply',
//     FORWARD: 'canForward',
//     DRAFT_EMAIL: 'canDraft',
//     APPLY_LABEL: 'canApplyLabel',
//     REMOVE_LABEL: 'canRemoveLabel',
//     ARCHIVE: 'canArchive',
//     MARK_SPAM: 'canMarkSpam',
//     MARK_TRASH: 'canMarkTrash',
//     ASSIGN_THREAD: 'canAssignThreads',
//     ARCHIVE_THREAD: 'canArchive',
//     UNARCHIVE_THREAD: 'canArchive',
//     MOVE_TO_TRASH: 'canMarkTrash',
//     REACT_TO_MESSAGE: 'canReact',
//     SHARE_MESSAGE: 'canShare',
//   }
//   const requiredCapability = actionCapabilityMap[actionType]
//   if (!requiredCapability) {
//     // Action type not in map, assume it's a universal action (like APPLY_TAG)
//     return true
//   }
//   return providerSupportsCapability(providerType, requiredCapability)
// }
