// packages/database/src/enums.ts
// Client-safe enum values generated from Drizzle enums

export const ActionTypeValues = [
  'ARCHIVE',
  'LABEL',
  'REPLY',
  'FORWARD',
  'MARK_SPAM',
  'DRAFT_EMAIL',
  'SEND_MESSAGE',
  'APPLY_TAG',
  'REMOVE_TAG',
  'APPLY_LABEL',
  'REMOVE_LABEL',
  'MARK_TRASH',
  'ASSIGN_THREAD',
  'ARCHIVE_THREAD',
  'UNARCHIVE_THREAD',
  'MOVE_TO_TRASH',
  'REACT_TO_MESSAGE',
  'SHARE_MESSAGE',
  'SEND_SMS',
  'MAKE_CALL',
  'ESCALATE',
  'ASSIGN',
  'NOTIFY',
  'CREATE_TICKET',
  'SHOPIFY_ORDER_LOOKUP',
  'SHOPIFY_GENERATE_RESPONSE',
] as const

export const AiIntegrationStatusValues = ['PENDING', 'VALID', 'INVALID'] as const

export const ApprovalActionValues = ['approve', 'deny'] as const

export const ApprovalStatusValues = ['pending', 'approved', 'denied', 'timeout'] as const

export const ArticleStatusValues = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const

export const AssetVersionStatusValues = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const

export const BillingCycleValues = ['MONTHLY', 'ANNUAL'] as const

export const ChunkingStrategyValues = [
  'FIXED_SIZE',
  'SEMANTIC',
  'SENTENCE',
  'PARAGRAPH',
  'DOCUMENT',
] as const

export const FieldTypeValues = [
  'PHONE',
  'EMAIL',
  'ADDRESS',
  'URL',
  'TAGS',
  'DATE',
  'DATETIME',
  'TIME',
  'CHECKBOX',
  'TEXT',
  'NUMBER',
  'CURRENCY',
  'MULTI_SELECT',
  'SINGLE_SELECT',
  'RICH_TEXT',
  'PHONE_INTL',
  'ADDRESS_STRUCT',
  'FILE',
  'NAME',
  'RELATIONSHIP',
] as const

export const CustomerSourceTypeValues = [
  'EMAIL',
  'TICKET_SYSTEM',
  'SHOPIFY',
  'MANUAL',
  'OTHER',
  'FACEBOOK_PSID',
] as const

export const CustomerStatusValues = ['ACTIVE', 'INACTIVE', 'SPAM', 'MERGED'] as const

// ============================================================================
// MODEL TYPES - SINGLE SOURCE OF TRUTH FOR DATA MODELS
// ============================================================================

/**
 * Model type values (lowercase, stored as text in database)
 *
 * These are the core system models with predefined schemas.
 * Custom entities use 'entity' type with EntityDefinition.
 */
export const ModelTypeValues = [
  'contact',
  'ticket',
  'thread',
  'user',
  'inbox',
  'message',
  'participant',
  'dataset',
  'entity', // For custom EntityDefinition instances
  'part',
] as const

/**
 * Model type - union of all valid model type strings
 */
export type ModelType = (typeof ModelTypeValues)[number]

/**
 * Model type const object - use for comparisons and iteration
 *
 * @example
 * if (field.modelType === ModelTypes.CONTACT) { ... }
 */
export const ModelTypes = {
  CONTACT: 'contact',
  TICKET: 'ticket',
  THREAD: 'thread',
  USER: 'user',
  INBOX: 'inbox',
  MESSAGE: 'message',
  PARTICIPANT: 'participant',
  DATASET: 'dataset',
  ENTITY: 'entity',
  PART: 'part',
} as const

/**
 * Model type metadata - labels, icons, plurals
 */
export const ModelTypeMeta: Record<
  ModelType,
  { label: string; plural: string; icon: string; dbTable: string }
> = {
  contact: { label: 'Contact', plural: 'Contacts', icon: 'user', dbTable: 'Contact' },
  ticket: { label: 'Ticket', plural: 'Tickets', icon: 'ticket', dbTable: 'Ticket' },
  thread: { label: 'Thread', plural: 'Threads', icon: 'message-square', dbTable: 'Thread' },
  user: { label: 'User', plural: 'Users', icon: 'users', dbTable: 'User' },
  inbox: { label: 'Inbox', plural: 'Inboxes', icon: 'inbox', dbTable: 'Inbox' },
  message: { label: 'Message', plural: 'Messages', icon: 'mail', dbTable: 'Message' },
  participant: {
    label: 'Participant',
    plural: 'Participants',
    icon: 'user',
    dbTable: 'Participant',
  },
  dataset: { label: 'Dataset', plural: 'Datasets', icon: 'database', dbTable: 'Dataset' },
  entity: { label: 'Entity', plural: 'Entities', icon: 'box', dbTable: 'EntityInstance' },
  part: { label: 'Part', plural: 'Parts', icon: 'package', dbTable: 'Part' },
}

export const DatasetStatusValues = ['ACTIVE', 'INACTIVE', 'PROCESSING', 'ERROR'] as const

export const DeliveryStatusValues = [
  'DELIVERED',
  'BOUNCED',
  'DELAYED',
  'DEFERRED',
  'REJECTED',
] as const

export const DocumentStatusValues = [
  'UPLOADED',
  'PROCESSING',
  'INDEXED',
  'FAILED',
  'ARCHIVED',
  'WAITING',
] as const

export const DocumentTypeValues = [
  'PDF',
  'DOCX',
  'TXT',
  'HTML',
  'MARKDOWN',
  'CSV',
  'JSON',
  'XML',
] as const

export const DomainTypeValues = ['CUSTOM', 'PROVIDER'] as const

export const DraftModeValues = ['NONE', 'PRIVATE', 'SHARED'] as const

export const EmailLabelValues = ['inbox', 'sent', 'draft'] as const

export const EmailProviderValues = ['GMAIL', 'OUTLOOK', 'IMAP'] as const

export const EmailTemplateTypeValues = [
  'TICKET_CREATED',
  'TICKET_REPLIED',
  'TICKET_CLOSED',
  'TICKET_REOPENED',
  'TICKET_ASSIGNED',
  'TICKET_STATUS_CHANGED',
  'CUSTOM',
] as const

export const ExtractionRuleTypeValues = [
  'REGEX',
  'MARKER',
  'POSITION',
  'AI_ASSISTED',
  'VISUAL_SELECTION',
] as const

export const FULFILLMENT_STATUSValues = [
  'CANCELLED',
  'ERROR',
  'FAILURE',
  'SUCCESS',
  'OPEN',
  'PENDING',
] as const

export const FileStatusValues = ['PENDING', 'CONFIRMED', 'ARCHIVED', 'DELETED', 'FAILED'] as const

export const FileVisibilityValues = ['PUBLIC', 'PRIVATE', 'INTERNAL'] as const

export const INVENTORY_POLICYValues = ['CONTINUE', 'DENY'] as const

export const IdentifierTypeValues = ['EMAIL', 'PHONE', 'FACEBOOK_PSID', 'INSTAGRAM_IGSID'] as const

export const InboxStatusValues = ['ACTIVE', 'ARCHIVED', 'PAUSED'] as const

export const IndexStatusValues = ['PENDING', 'INDEXED', 'ERROR'] as const

export const IntegrationAuthStatusValues = [
  'AUTHENTICATED',
  'UNAUTHENTICATED',
  'ERROR',
  'INVALID_GRANT',
  'EXPIRED_TOKEN',
  'REVOKED_ACCESS',
  'INSUFFICIENT_SCOPE',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
] as const

export const IntegrationProviderTypeValues = [
  'google',
  'outlook',
  'facebook',
  'instagram',
  'openphone',
  'mailgun',
  'sms',
  'whatsapp',
  'chat',
  'email',
  'shopify',
] as const

export const IntegrationTypeValues = [
  'GOOGLE',
  'OUTLOOK',
  'OPENPHONE',
  'FACEBOOK',
  'INSTAGRAM',
  'CHAT',
] as const

export const InvitationStatusValues = ['PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED'] as const

export const InvoiceStatusValues = ['PENDING', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'DRAFT'] as const

export const JobStatusValues = [
  'PENDING',
  'PROCESSING',
  'COMPLETED_SUCCESS',
  'COMPLETED_PARTIAL',
  'COMPLETED_FAILURE',
  'FAILED',
  'RETRYING',
] as const

export const LabelTypeValues = ['system', 'user'] as const

export const MEDIA_CONTENT_TYPEValues = ['EXTERNAL_VIDEO', 'IMAGE', 'MODEL_3D', 'VIDEO'] as const

export const MeetingMessageMethodValues = [
  'request',
  'reply',
  'cancel',
  'counter',
  'other',
] as const

export const MessageTypeValues = [
  'EMAIL',
  'FACEBOOK',
  'SMS',
  'WHATSAPP',
  'INSTAGRAM',
  'OPENPHONE',
  'CHAT',
] as const

export const AiModelTypeValues = [
  'LLM',
  'TEXT_EMBEDDING',
  'RERANK',
  'TTS',
  'SPEECH2TEXT',
  'MODERATION',
  'VISION',
] as const

export const NodeExecutionStatusValues = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'exception',
  'skipped',
  'stopped',
  'waiting',
] as const

export const NodeTriggerSourceValues = ['SINGLE_STEP', 'WORKFLOW_RUN'] as const

export const NotificationTypeValues = [
  'COMMENT_MENTION',
  'COMMENT_REPLY',
  'COMMENT_REACTION',
  'TICKET_ASSIGNED',
  'TICKET_UPDATED',
  'TICKET_MENTIONED',
  'THREAD_ACTIVITY',
  'SYSTEM_MESSAGE',
  'WORKFLOW_APPROVAL_REQUIRED',
  'WORKFLOW_APPROVAL_REMINDER',
  'WORKFLOW_APPROVAL_COMPLETED',
] as const

export const ORDER_ADDRESS_TYPEValues = ['SHIPPING', 'BILLING'] as const

export const ORDER_CANCEL_REASONValues = [
  'CUSTOMER',
  'DECLINED',
  'FRAUD',
  'INVENTORY',
  'OTHER',
  'STAFF',
] as const

export const ORDER_FINANCIAL_STATUSValues = [
  'AUTHORIZED',
  'EXPIRED',
  'PAID',
  'PARTIALLY_PAID',
  'PARTIALLY_REFUNDED',
  'PENDING',
  'REFUNDED',
  'VOIDED',
] as const

export const ORDER_FULFILLMENT_STATUSValues = [
  'FULFILLED',
  'IN_PROGRESS',
  'ON_HOLD',
  'OPEN',
  'PARTIALLY_FULFILLED',
  'PENDING_FULFILLMENT',
  'REQUEST_DECLINED',
  'RESTOCKED',
  'SCHEDULED',
  'UNFULFILLED',
] as const

export const ORDER_RETURN_STATUSValues = [
  'INSPECTION_COMPLETED',
  'IN_PROGRESS',
  'NO_RETURN',
  'RETURNED',
  'RETURN_FAILED',
  'RETURN_REQUESTED',
] as const

export const OrganizationMemberStatusValues = ['ACTIVE', 'INACTIVE'] as const

export const OrganizationRoleValues = ['OWNER', 'ADMIN', 'USER'] as const

export const OrganizationTypeValues = ['INDIVIDUAL', 'TEAM'] as const

export const PRODUDT_STATUSValues = ['ACTIVE', 'ARCHIVED', 'DRAFT'] as const

export const ParticipantRoleValues = ['FROM', 'TO', 'CC', 'BCC', 'REPLY_TO'] as const

export const ProposedActionStatusValues = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
] as const

export const ProviderQuotaTypeValues = ['PAID', 'FREE', 'TRIAL'] as const

export const ProviderTypeValues = ['SYSTEM', 'CUSTOM'] as const

export const RETURN_STATUSValues = ['CANCELLED', 'CLOSED', 'DECLINED', 'OPEN', 'REQUESTED'] as const

export const RecipientRoleValues = ['FROM', 'TO', 'CC', 'BCC'] as const

export const ResponseStatusValues = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const

export const ResponseTypeValues = [
  'MANUAL',
  'TEMPLATE',
  'AI_GENERATED',
  'RULE_BASED',
  'HYBRID',
] as const

export const RuleGroupOperatorValues = ['AND', 'OR', 'NOT', 'XOR', 'THRESHOLD'] as const

export const RuleTypeValues = [
  'STATIC',
  'CATEGORY',
  'AI',
  'SPAM_HANDLER',
  'RULE_GROUP',
  'SHOPIFY_AUTOMATION',
] as const

export const SYNC_STATUSValues = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] as const

export const SendStatusValues = ['PENDING', 'SENT', 'FAILED'] as const

export const SenderTypeValues = [
  'INTERNAL_STAFF',
  'INTERNAL_SYSTEM',
  'PARTNER',
  'CUSTOMER',
  'VENDOR',
  'UNKNOWN_EXTERNAL',
] as const

export const SensitivityValues = ['normal', 'private', 'personal', 'confidential'] as const

export const SettingScopeValues = [
  'APPEARANCE',
  'NOTIFICATION',
  'DASHBOARD',
  'COMMUNICATION',
  'SECURITY',
  'INTEGRATION',
  'GENERAL',
  'SIDEBAR',
] as const

export const SignatureSharingTypeValues = [
  'PRIVATE',
  'ORGANIZATION_WIDE',
  'SPECIFIC_INTEGRATIONS',
] as const

export const SnippetPermissionValues = ['VIEW', 'EDIT'] as const

export const SnippetSharingTypeValues = ['PRIVATE', 'ORGANIZATION', 'GROUPS', 'MEMBERS'] as const

export const StaticRuleTypeValues = [
  'SENDER_DOMAIN',
  'SENDER_ADDRESS',
  'RECIPIENT_PATTERN',
  'SUBJECT_MATCH',
  'BODY_KEYWORD',
  'HEADER_CHECK',
  'ATTACHMENT_TYPE',
  'COMBINED',
  'INTERNAL_EXTERNAL',
  'THREAD_BASED',
] as const

export const StorageProviderValues = [
  'S3',
  'GOOGLE_DRIVE',
  'DROPBOX',
  'ONEDRIVE',
  'BOX',
  'GENERIC_URL',
] as const

/** Stripe subscription status values - stored as lowercase to match Stripe API */
export const SubscriptionStatusValues = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const

/** Stripe subscription status type */
export type SubscriptionStatus = (typeof SubscriptionStatusValues)[number]

export const TestCaseStatusValues = ['ACTIVE', 'INACTIVE', 'DRAFT'] as const

export const TestRunStatusValues = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const

export const ThreadStatusValues = [
  'OPEN',
  'ARCHIVED',
  'ACTIVE',
  'RESOLVED',
  'PENDING',
  'CLOSED',
  'SPAM',
  'TRASH',
] as const

export const ThreadTypeValues = ['EMAIL', 'CHAT'] as const

export const TicketPriorityValues = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

export const TicketStatusValues = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_THIRD_PARTY',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
  'MERGED',
] as const

export const TicketTypeValues = [
  'GENERAL',
  'MISSING_ITEM',
  'RETURN',
  'REFUND',
  'PRODUCT_ISSUE',
  'SHIPPING_ISSUE',
  'BILLING',
  'TECHNICAL',
  'OTHER',
] as const

export const TrialConversionStatusValues = [
  'TRIAL_ACTIVE',
  'CONVERTED_TO_PAID',
  'EXPIRED_WITHOUT_CONVERSION',
  'CANCELED_DURING_TRIAL',
  'MANUAL_CONVERSION',
] as const

export const UserTypeValues = ['USER', 'SYSTEM'] as const

export const VectorDbTypeValues = [
  'POSTGRESQL',
  'CHROMA',
  'QDRANT',
  'WEAVIATE',
  'PINECONE',
  'MILVUS',
] as const

export const WorkflowRunStatusValues = [
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'STOPPED',
  'WAITING',
] as const

export const WorkflowTriggerSourceValues = [
  'DEBUGGING',
  'APP_RUN',
  'SINGLE_STEP',
  'PUBLIC_SHARE',
  'API_KEY',
  'WEBHOOK',
] as const

export const WorkflowShareAccessModeValues = ['public', 'organization'] as const

// EntityDefinition string constants (not database enums - stored as text)
export const EntityTypeValues = ['standard', 'contact', 'user', 'thread', 'ticket'] as const

export const StandardTypeValues = ['company', 'task', 'deal', 'custom'] as const

// ============================================================================
// ENUM OBJECTS - Can be used both as types and values on client-side
// ============================================================================

export const ActionType = {
  ARCHIVE: 'ARCHIVE',
  LABEL: 'LABEL',
  REPLY: 'REPLY',
  FORWARD: 'FORWARD',
  MARK_SPAM: 'MARK_SPAM',
  DRAFT_EMAIL: 'DRAFT_EMAIL',
  SEND_MESSAGE: 'SEND_MESSAGE',
  APPLY_TAG: 'APPLY_TAG',
  REMOVE_TAG: 'REMOVE_TAG',
  APPLY_LABEL: 'APPLY_LABEL',
  REMOVE_LABEL: 'REMOVE_LABEL',
  MARK_TRASH: 'MARK_TRASH',
  ASSIGN_THREAD: 'ASSIGN_THREAD',
  ARCHIVE_THREAD: 'ARCHIVE_THREAD',
  UNARCHIVE_THREAD: 'UNARCHIVE_THREAD',
  MOVE_TO_TRASH: 'MOVE_TO_TRASH',
  REACT_TO_MESSAGE: 'REACT_TO_MESSAGE',
  SHARE_MESSAGE: 'SHARE_MESSAGE',
  SEND_SMS: 'SEND_SMS',
  MAKE_CALL: 'MAKE_CALL',
  ESCALATE: 'ESCALATE',
  ASSIGN: 'ASSIGN',
  NOTIFY: 'NOTIFY',
  CREATE_TICKET: 'CREATE_TICKET',
  SHOPIFY_ORDER_LOOKUP: 'SHOPIFY_ORDER_LOOKUP',
  SHOPIFY_GENERATE_RESPONSE: 'SHOPIFY_GENERATE_RESPONSE',
} as const

export const AiIntegrationStatus = {
  PENDING: 'PENDING',
  VALID: 'VALID',
  INVALID: 'INVALID',
} as const

export const ApprovalAction = {
  approve: 'approve',
  deny: 'deny',
} as const

export const ApprovalStatus = {
  pending: 'pending',
  approved: 'approved',
  denied: 'denied',
  timeout: 'timeout',
} as const

export const ArticleStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const

export const AssetVersionStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const

export const BillingCycle = {
  MONTHLY: 'MONTHLY',
  ANNUAL: 'ANNUAL',
} as const

export const ChunkingStrategy = {
  FIXED_SIZE: 'FIXED_SIZE',
  SEMANTIC: 'SEMANTIC',
  SENTENCE: 'SENTENCE',
  PARAGRAPH: 'PARAGRAPH',
  DOCUMENT: 'DOCUMENT',
} as const

export const FieldType = {
  // PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  ADDRESS: 'ADDRESS',
  URL: 'URL',
  TAGS: 'TAGS',
  DATE: 'DATE',
  DATETIME: 'DATETIME',
  TIME: 'TIME',
  CHECKBOX: 'CHECKBOX',
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  CURRENCY: 'CURRENCY',
  MULTI_SELECT: 'MULTI_SELECT',
  SINGLE_SELECT: 'SINGLE_SELECT',
  RICH_TEXT: 'RICH_TEXT',
  PHONE_INTL: 'PHONE_INTL',
  ADDRESS_STRUCT: 'ADDRESS_STRUCT',
  FILE: 'FILE',
  NAME: 'NAME',
  RELATIONSHIP: 'RELATIONSHIP',
} as const

export const CustomerSourceType = {
  EMAIL: 'EMAIL',
  TICKET_SYSTEM: 'TICKET_SYSTEM',
  SHOPIFY: 'SHOPIFY',
  MANUAL: 'MANUAL',
  OTHER: 'OTHER',
  FACEBOOK_PSID: 'FACEBOOK_PSID',
} as const

export const CustomerStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SPAM: 'SPAM',
  MERGED: 'MERGED',
} as const

export const DatasetStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PROCESSING: 'PROCESSING',
  ERROR: 'ERROR',
} as const

export const DeliveryStatus = {
  DELIVERED: 'DELIVERED',
  BOUNCED: 'BOUNCED',
  DELAYED: 'DELAYED',
  DEFERRED: 'DEFERRED',
  REJECTED: 'REJECTED',
} as const

export const DocumentStatus = {
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  INDEXED: 'INDEXED',
  FAILED: 'FAILED',
  ARCHIVED: 'ARCHIVED',
  WAITING: 'WAITING',
} as const

export const DocumentType = {
  PDF: 'PDF',
  DOCX: 'DOCX',
  TXT: 'TXT',
  HTML: 'HTML',
  MARKDOWN: 'MARKDOWN',
  CSV: 'CSV',
  JSON: 'JSON',
  XML: 'XML',
} as const

export const DomainType = {
  CUSTOM: 'CUSTOM',
  PROVIDER: 'PROVIDER',
} as const

export const DraftMode = {
  NONE: 'NONE',
  PRIVATE: 'PRIVATE',
  SHARED: 'SHARED',
} as const

export const EmailLabel = {
  inbox: 'inbox',
  sent: 'sent',
  draft: 'draft',
} as const

export const EmailProvider = {
  GMAIL: 'GMAIL',
  OUTLOOK: 'OUTLOOK',
  IMAP: 'IMAP',
} as const

export const EmailTemplateType = {
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_REPLIED: 'TICKET_REPLIED',
  TICKET_CLOSED: 'TICKET_CLOSED',
  TICKET_REOPENED: 'TICKET_REOPENED',
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  CUSTOM: 'CUSTOM',
} as const

export const ExtractionRuleType = {
  REGEX: 'REGEX',
  MARKER: 'MARKER',
  POSITION: 'POSITION',
  AI_ASSISTED: 'AI_ASSISTED',
  VISUAL_SELECTION: 'VISUAL_SELECTION',
} as const

export const FULFILLMENT_STATUS = {
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
  FAILURE: 'FAILURE',
  SUCCESS: 'SUCCESS',
  OPEN: 'OPEN',
  PENDING: 'PENDING',
} as const

export const FileStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  ARCHIVED: 'ARCHIVED',
  DELETED: 'DELETED',
  FAILED: 'FAILED',
} as const

export const FileVisibility = {
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
  INTERNAL: 'INTERNAL',
} as const

export const INVENTORY_POLICY = {
  CONTINUE: 'CONTINUE',
  DENY: 'DENY',
} as const

export const IdentifierType = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  FACEBOOK_PSID: 'FACEBOOK_PSID',
  INSTAGRAM_IGSID: 'INSTAGRAM_IGSID',
} as const

export const InboxStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  PAUSED: 'PAUSED',
} as const

export const IndexStatus = {
  PENDING: 'PENDING',
  INDEXED: 'INDEXED',
  ERROR: 'ERROR',
} as const

export const IntegrationAuthStatus = {
  AUTHENTICATED: 'AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ERROR: 'ERROR',
  INVALID_GRANT: 'INVALID_GRANT',
  EXPIRED_TOKEN: 'EXPIRED_TOKEN',
  REVOKED_ACCESS: 'REVOKED_ACCESS',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export const IntegrationProviderType = {
  google: 'google',
  outlook: 'outlook',
  facebook: 'facebook',
  instagram: 'instagram',
  openphone: 'openphone',
  mailgun: 'mailgun',
  sms: 'sms',
  whatsapp: 'whatsapp',
  chat: 'chat',
  email: 'email',
  shopify: 'shopify',
} as const

export const IntegrationType = {
  GOOGLE: 'GOOGLE',
  OUTLOOK: 'OUTLOOK',
  OPENPHONE: 'OPENPHONE',
  FACEBOOK: 'FACEBOOK',
  INSTAGRAM: 'INSTAGRAM',
  CHAT: 'CHAT',
} as const

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const

export const InvoiceStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  VOID: 'VOID',
  UNCOLLECTIBLE: 'UNCOLLECTIBLE',
  DRAFT: 'DRAFT',
} as const

export const JobStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED_SUCCESS: 'COMPLETED_SUCCESS',
  COMPLETED_PARTIAL: 'COMPLETED_PARTIAL',
  COMPLETED_FAILURE: 'COMPLETED_FAILURE',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
} as const

export const LabelType = {
  system: 'system',
  user: 'user',
} as const

export const MEDIA_CONTENT_TYPE = {
  EXTERNAL_VIDEO: 'EXTERNAL_VIDEO',
  IMAGE: 'IMAGE',
  MODEL_3D: 'MODEL_3D',
  VIDEO: 'VIDEO',
} as const

export const MeetingMessageMethod = {
  request: 'request',
  reply: 'reply',
  cancel: 'cancel',
  counter: 'counter',
  other: 'other',
} as const

export const MessageType = {
  EMAIL: 'EMAIL',
  FACEBOOK: 'FACEBOOK',
  SMS: 'SMS',
  WHATSAPP: 'WHATSAPP',
  INSTAGRAM: 'INSTAGRAM',
  OPENPHONE: 'OPENPHONE',
  CHAT: 'CHAT',
} as const

export const AiModelType = {
  LLM: 'LLM',
  TEXT_EMBEDDING: 'TEXT_EMBEDDING',
  RERANK: 'RERANK',
  TTS: 'TTS',
  SPEECH2TEXT: 'SPEECH2TEXT',
  MODERATION: 'MODERATION',
  VISION: 'VISION',
} as const

export const NodeExecutionStatus = {
  pending: 'pending',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  exception: 'exception',
  skipped: 'skipped',
  stopped: 'stopped',
  waiting: 'waiting',
} as const

export const NodeTriggerSource = {
  SINGLE_STEP: 'SINGLE_STEP',
  WORKFLOW_RUN: 'WORKFLOW_RUN',
} as const

export const NotificationType = {
  COMMENT_MENTION: 'COMMENT_MENTION',
  COMMENT_REPLY: 'COMMENT_REPLY',
  COMMENT_REACTION: 'COMMENT_REACTION',
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_UPDATED: 'TICKET_UPDATED',
  TICKET_MENTIONED: 'TICKET_MENTIONED',
  THREAD_ACTIVITY: 'THREAD_ACTIVITY',
  SYSTEM_MESSAGE: 'SYSTEM_MESSAGE',
  WORKFLOW_APPROVAL_REQUIRED: 'WORKFLOW_APPROVAL_REQUIRED',
  WORKFLOW_APPROVAL_REMINDER: 'WORKFLOW_APPROVAL_REMINDER',
  WORKFLOW_APPROVAL_COMPLETED: 'WORKFLOW_APPROVAL_COMPLETED',
} as const

export const ORDER_ADDRESS_TYPE = {
  SHIPPING: 'SHIPPING',
  BILLING: 'BILLING',
} as const

export const ORDER_CANCEL_REASON = {
  CUSTOMER: 'CUSTOMER',
  DECLINED: 'DECLINED',
  FRAUD: 'FRAUD',
  INVENTORY: 'INVENTORY',
  OTHER: 'OTHER',
  STAFF: 'STAFF',
} as const

export const ORDER_FINANCIAL_STATUS = {
  AUTHORIZED: 'AUTHORIZED',
  EXPIRED: 'EXPIRED',
  PAID: 'PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  PENDING: 'PENDING',
  REFUNDED: 'REFUNDED',
  VOIDED: 'VOIDED',
} as const

export const ORDER_FULFILLMENT_STATUS = {
  FULFILLED: 'FULFILLED',
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  OPEN: 'OPEN',
  PARTIALLY_FULFILLED: 'PARTIALLY_FULFILLED',
  PENDING_FULFILLMENT: 'PENDING_FULFILLMENT',
  REQUEST_DECLINED: 'REQUEST_DECLINED',
  RESTOCKED: 'RESTOCKED',
  SCHEDULED: 'SCHEDULED',
  UNFULFILLED: 'UNFULFILLED',
} as const

export const ORDER_RETURN_STATUS = {
  INSPECTION_COMPLETED: 'INSPECTION_COMPLETED',
  IN_PROGRESS: 'IN_PROGRESS',
  NO_RETURN: 'NO_RETURN',
  RETURNED: 'RETURNED',
  RETURN_FAILED: 'RETURN_FAILED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
} as const

export const OrganizationMemberStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const

export const OrganizationRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const

export const OrganizationType = {
  INDIVIDUAL: 'INDIVIDUAL',
  TEAM: 'TEAM',
} as const

export const PRODUDT_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  DRAFT: 'DRAFT',
} as const

export const ParticipantRole = {
  FROM: 'FROM',
  TO: 'TO',
  CC: 'CC',
  BCC: 'BCC',
  REPLY_TO: 'REPLY_TO',
} as const

export const ProposedActionStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXECUTED: 'EXECUTED',
  FAILED: 'FAILED',
} as const

export const ProviderQuotaType = {
  PAID: 'PAID',
  FREE: 'FREE',
  TRIAL: 'TRIAL',
} as const

export const ProviderType = {
  SYSTEM: 'SYSTEM',
  CUSTOM: 'CUSTOM',
} as const

export const RETURN_STATUS = {
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
  DECLINED: 'DECLINED',
  OPEN: 'OPEN',
  REQUESTED: 'REQUESTED',
} as const

export const RecipientRole = {
  FROM: 'FROM',
  TO: 'TO',
  CC: 'CC',
  BCC: 'BCC',
} as const

export const ResponseStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  SCHEDULED: 'SCHEDULED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const

export const ResponseType = {
  MANUAL: 'MANUAL',
  TEMPLATE: 'TEMPLATE',
  AI_GENERATED: 'AI_GENERATED',
  RULE_BASED: 'RULE_BASED',
  HYBRID: 'HYBRID',
} as const

export const RuleGroupOperator = {
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  XOR: 'XOR',
  THRESHOLD: 'THRESHOLD',
} as const

export const RuleType = {
  STATIC: 'STATIC',
  CATEGORY: 'CATEGORY',
  AI: 'AI',
  SPAM_HANDLER: 'SPAM_HANDLER',
  RULE_GROUP: 'RULE_GROUP',
  SHOPIFY_AUTOMATION: 'SHOPIFY_AUTOMATION',
} as const

export const SYNC_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const

export const SendStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const

export const SenderType = {
  INTERNAL_STAFF: 'INTERNAL_STAFF',
  INTERNAL_SYSTEM: 'INTERNAL_SYSTEM',
  PARTNER: 'PARTNER',
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  UNKNOWN_EXTERNAL: 'UNKNOWN_EXTERNAL',
} as const

export const Sensitivity = {
  normal: 'normal',
  private: 'private',
  personal: 'personal',
  confidential: 'confidential',
} as const

export const SettingScope = {
  APPEARANCE: 'APPEARANCE',
  NOTIFICATION: 'NOTIFICATION',
  DASHBOARD: 'DASHBOARD',
  COMMUNICATION: 'COMMUNICATION',
  SECURITY: 'SECURITY',
  INTEGRATION: 'INTEGRATION',
  GENERAL: 'GENERAL',
  SIDEBAR: 'SIDEBAR',
} as const

export const SignatureSharingType = {
  PRIVATE: 'PRIVATE',
  ORGANIZATION_WIDE: 'ORGANIZATION_WIDE',
  SPECIFIC_INTEGRATIONS: 'SPECIFIC_INTEGRATIONS',
} as const

export const SnippetPermission = {
  VIEW: 'VIEW',
  EDIT: 'EDIT',
} as const

export const SnippetSharingType = {
  PRIVATE: 'PRIVATE',
  ORGANIZATION: 'ORGANIZATION',
  GROUPS: 'GROUPS',
  MEMBERS: 'MEMBERS',
} as const

export const StaticRuleType = {
  SENDER_DOMAIN: 'SENDER_DOMAIN',
  SENDER_ADDRESS: 'SENDER_ADDRESS',
  RECIPIENT_PATTERN: 'RECIPIENT_PATTERN',
  SUBJECT_MATCH: 'SUBJECT_MATCH',
  BODY_KEYWORD: 'BODY_KEYWORD',
  HEADER_CHECK: 'HEADER_CHECK',
  ATTACHMENT_TYPE: 'ATTACHMENT_TYPE',
  COMBINED: 'COMBINED',
  INTERNAL_EXTERNAL: 'INTERNAL_EXTERNAL',
  THREAD_BASED: 'THREAD_BASED',
} as const

export const StorageProvider = {
  S3: 'S3',
  GOOGLE_DRIVE: 'GOOGLE_DRIVE',
  DROPBOX: 'DROPBOX',
  ONEDRIVE: 'ONEDRIVE',
  BOX: 'BOX',
  GENERIC_URL: 'GENERIC_URL',
} as const

/** Stripe subscription status constants - use for comparisons */
export const SubscriptionStatus = {
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  UNPAID: 'unpaid',
  PAUSED: 'paused',
} as const

export const TestCaseStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DRAFT: 'DRAFT',
} as const

export const TestRunStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const

export const ThreadStatus = {
  OPEN: 'OPEN',
  ARCHIVED: 'ARCHIVED',
  ACTIVE: 'ACTIVE',
  RESOLVED: 'RESOLVED',
  PENDING: 'PENDING',
  CLOSED: 'CLOSED',
  SPAM: 'SPAM',
  TRASH: 'TRASH',
} as const

export const ThreadType = {
  EMAIL: 'EMAIL',
  CHAT: 'CHAT',
} as const

export const TicketPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const

export const TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_FOR_CUSTOMER: 'WAITING_FOR_CUSTOMER',
  WAITING_FOR_THIRD_PARTY: 'WAITING_FOR_THIRD_PARTY',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  MERGED: 'MERGED',
} as const

export const TicketType = {
  GENERAL: 'GENERAL',
  MISSING_ITEM: 'MISSING_ITEM',
  RETURN: 'RETURN',
  REFUND: 'REFUND',
  PRODUCT_ISSUE: 'PRODUCT_ISSUE',
  SHIPPING_ISSUE: 'SHIPPING_ISSUE',
  BILLING: 'BILLING',
  TECHNICAL: 'TECHNICAL',
  OTHER: 'OTHER',
} as const

export const TrialConversionStatus = {
  TRIAL_ACTIVE: 'TRIAL_ACTIVE',
  CONVERTED_TO_PAID: 'CONVERTED_TO_PAID',
  EXPIRED_WITHOUT_CONVERSION: 'EXPIRED_WITHOUT_CONVERSION',
  CANCELED_DURING_TRIAL: 'CANCELED_DURING_TRIAL',
  MANUAL_CONVERSION: 'MANUAL_CONVERSION',
} as const

export const UserType = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const

export const VectorDbType = {
  POSTGRESQL: 'POSTGRESQL',
  CHROMA: 'CHROMA',
  QDRANT: 'QDRANT',
  WEAVIATE: 'WEAVIATE',
  PINECONE: 'PINECONE',
  MILVUS: 'MILVUS',
} as const

export const WorkflowRunStatus = {
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED',
  WAITING: 'WAITING',
} as const

export const WorkflowTriggerSource = {
  DEBUGGING: 'DEBUGGING',
  APP_RUN: 'APP_RUN',
  SINGLE_STEP: 'SINGLE_STEP',
  PUBLIC_SHARE: 'PUBLIC_SHARE',
  API_KEY: 'API_KEY',
  WEBHOOK: 'WEBHOOK',
} as const

export const WorkflowShareAccessMode = {
  PUBLIC: 'public',
  ORGANIZATION: 'organization',
} as const

// EntityDefinition type objects (not database enums - stored as text fields)
export const EntityType = {
  STANDARD: 'standard',
  CONTACT: 'contact',
  USER: 'user',
  THREAD: 'thread',
  TICKET: 'ticket',
} as const

export const StandardType = {
  COMPANY: 'company',
  TASK: 'task',
  DEAL: 'deal',
  CUSTOM: 'custom',
} as const
