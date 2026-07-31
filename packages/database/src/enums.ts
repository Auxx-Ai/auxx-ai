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

export const ApprovalStatusValues = [
  'pending',
  'approved',
  'denied',
  'timeout',
  'withdrawn',
  'superseded',
] as const

export const ApprovalKindValues = ['workflow', 'access'] as const

export const ArticleStatusValues = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const

export const ArticleKindValues = ['page', 'category', 'header', 'tab', 'link'] as const

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
  'CALC',
  'ACTOR',
  'JSON',
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
  // Personal mailboxes (plan 40 §3) — a SEPARATE EntityDefinition from `inbox`, so
  // personal-ness is unforgeable def membership instead of an `inbox_is_personal`
  // FieldValue. Not to be confused with `InternalFilterContextType.PERSONAL_INBOX`
  // (`packages/lib/src/mail-query/types.ts`), which is a mail-URL context meaning
  // "assigned to me" — different namespace, no runtime intersection.
  'personal_inbox',
  'message',
  'participant',
  'dataset',
  'entity', // For custom EntityDefinition instances
  'part',
  'vendor_part',
  'subpart',
  'stock_movement',
  'company',
  'meeting',
  'article',
  'kb',
  'work_order',
  'visit',
  'service_request',
  'quote',
  'line_item',
  'catalog_item',
  'catalog_group',
  'invoice',
  'payment',
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
  PERSONAL_INBOX: 'personal_inbox',
  MESSAGE: 'message',
  PARTICIPANT: 'participant',
  DATASET: 'dataset',
  ENTITY: 'entity',
  PART: 'part',
  VENDOR_PART: 'vendor_part',
  SUBPART: 'subpart',
  STOCK_MOVEMENT: 'stock_movement',
  COMPANY: 'company',
  MEETING: 'meeting',
  ARTICLE: 'article',
  KB: 'kb',
  WORK_ORDER: 'work_order',
  VISIT: 'visit',
  SERVICE_REQUEST: 'service_request',
  QUOTE: 'quote',
  LINE_ITEM: 'line_item',
  CATALOG_ITEM: 'catalog_item',
  CATALOG_GROUP: 'catalog_group',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
} as const

/**
 * Model type metadata - labels, icons, plurals, colors, apiSlugs
 */
export const ModelTypeMeta: Record<
  ModelType,
  {
    label: string
    plural: string
    icon: string
    color: string
    apiSlug: string
    dbTable: string
    /**
     * Whether this type has a full `/app/<apiSlug>/<id>` detail page (hand-authored
     * route folder — there is no catch-all). Gates the record drawer's fullscreen
     * button and the `getRecordLink`/`recordHref` builders via `resourceHasDetailPage`.
     * Custom entity defs always have a page (generic `custom/[slug]/[id]`) and are
     * handled in that helper, not here.
     */
    hasDetailPage: boolean
  }
> = {
  contact: {
    label: 'Contact',
    plural: 'Contacts',
    icon: 'user',
    color: 'indigo',
    apiSlug: 'contacts',
    dbTable: 'Contact',
    hasDetailPage: true,
  },
  ticket: {
    label: 'Ticket',
    plural: 'Tickets',
    icon: 'ticket',
    color: 'blue',
    apiSlug: 'tickets',
    dbTable: 'Ticket',
    hasDetailPage: true,
  },
  thread: {
    label: 'Thread',
    plural: 'Threads',
    icon: 'message-square',
    color: 'purple',
    apiSlug: 'threads',
    dbTable: 'Thread',
    hasDetailPage: false,
  },
  user: {
    label: 'User',
    plural: 'Users',
    icon: 'users',
    color: 'green',
    apiSlug: 'users',
    dbTable: 'User',
    hasDetailPage: false,
  },
  inbox: {
    label: 'Inbox',
    plural: 'Inboxes',
    icon: 'inbox',
    color: 'indigo',
    apiSlug: 'inboxes',
    dbTable: 'Inbox',
    hasDetailPage: false,
  },
  // Mirrors `inbox` — both are def-backed (`ENTITY_DEFINITION_TYPES`), so
  // `dbTable` is inert for them: it is only read by `RESOURCE_TABLE_REGISTRY`
  // (`resources/registry/field-registry.ts`), which excludes every entry in
  // `ENTITY_DEFINITION_TYPES`. What IS load-bearing here is `apiSlug`, which
  // feeds the dynamic RecordId-prefix alias set (`resources/static-prefixes.ts`).
  personal_inbox: {
    label: 'Personal Inbox',
    plural: 'Personal Inboxes',
    icon: 'inbox',
    color: 'indigo',
    apiSlug: 'personal-inboxes',
    dbTable: 'Inbox',
    hasDetailPage: false,
  },
  message: {
    label: 'Message',
    plural: 'Messages',
    icon: 'mail',
    color: 'teal',
    apiSlug: 'messages',
    dbTable: 'Message',
    hasDetailPage: false,
  },
  participant: {
    label: 'Participant',
    plural: 'Participants',
    icon: 'user',
    color: 'amber',
    apiSlug: 'participants',
    dbTable: 'Participant',
    hasDetailPage: false,
  },
  dataset: {
    label: 'Dataset',
    plural: 'Datasets',
    icon: 'database',
    color: 'purple',
    apiSlug: 'datasets',
    dbTable: 'Dataset',
    hasDetailPage: true,
  },
  entity: {
    label: 'Entity',
    plural: 'Entities',
    icon: 'box',
    color: 'gray',
    apiSlug: 'entities',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  part: {
    label: 'Part',
    plural: 'Parts',
    icon: 'package',
    color: 'orange',
    apiSlug: 'parts',
    dbTable: 'EntityInstance',
    hasDetailPage: true,
  },
  vendor_part: {
    label: 'Vendor Part',
    plural: 'Vendor Parts',
    icon: 'package',
    color: 'orange',
    apiSlug: 'vendor-parts',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  subpart: {
    label: 'Subpart',
    plural: 'Subparts',
    icon: 'layers',
    color: 'orange',
    apiSlug: 'subparts',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  stock_movement: {
    label: 'Stock Movement',
    plural: 'Stock Movements',
    icon: 'arrow-left-right',
    color: 'emerald',
    apiSlug: 'stock-movements',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  company: {
    label: 'Company',
    plural: 'Companies',
    icon: 'building-2',
    color: 'blue',
    apiSlug: 'companies',
    dbTable: 'EntityInstance',
    hasDetailPage: true,
  },
  meeting: {
    label: 'Meeting',
    plural: 'Meetings',
    icon: 'calendar',
    color: 'blue',
    apiSlug: 'meetings',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  article: {
    label: 'Article',
    plural: 'Articles',
    icon: 'book-open',
    color: 'cyan',
    apiSlug: 'articles',
    dbTable: 'Article',
    hasDetailPage: false,
  },
  kb: {
    label: 'Knowledge Base',
    plural: 'Knowledge Bases',
    icon: 'book-open',
    color: 'violet',
    // apiSlug must match the in-app route segment (/app/kb/<id>), since
    // getRecordLink derives record hrefs as `/app/<apiSlug>/<id>`.
    apiSlug: 'kb',
    dbTable: 'KnowledgeBase',
    hasDetailPage: true,
  },
  work_order: {
    label: 'Work Order',
    plural: 'Work Orders',
    icon: 'wrench',
    color: 'amber',
    apiSlug: 'work-orders',
    dbTable: 'EntityInstance',
    // Flipped for the job view (dispatch M2 build spec §F.2) — the drawer grows
    // its fullscreen button and `getRecordLink` starts returning
    // `/app/work-orders/[id]` URLs. `service_request` stays drawer-only.
    hasDetailPage: true,
  },
  visit: {
    label: 'Visit',
    plural: 'Visits',
    icon: 'calendar',
    color: 'sky',
    apiSlug: 'visits',
    dbTable: 'WorkOrderVisit',
    hasDetailPage: false,
  },
  service_request: {
    label: 'Service Request',
    plural: 'Service Requests',
    icon: 'clipboard-list',
    color: 'cyan',
    apiSlug: 'service-requests',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  quote: {
    label: 'Quote',
    plural: 'Quotes',
    icon: 'file-text',
    color: 'violet',
    apiSlug: 'quotes',
    dbTable: 'EntityInstance',
    hasDetailPage: true,
  },
  line_item: {
    label: 'Line Item',
    plural: 'Line Items',
    icon: 'list',
    color: 'gray',
    apiSlug: 'line-items',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  catalog_item: {
    label: 'Product / Service',
    plural: 'Products & Services',
    icon: 'tags',
    color: 'teal',
    apiSlug: 'catalog-items',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  catalog_group: {
    label: 'Product Group',
    plural: 'Product Groups',
    icon: 'boxes',
    color: 'teal',
    apiSlug: 'catalog-groups',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  invoice: {
    label: 'Invoice',
    plural: 'Invoices',
    icon: 'receipt',
    color: 'green',
    apiSlug: 'invoices',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
  payment: {
    label: 'Payment',
    plural: 'Payments',
    icon: 'banknote',
    color: 'emerald',
    apiSlug: 'payments',
    dbTable: 'EntityInstance',
    hasDetailPage: false,
  },
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

// @deprecated - DraftMode is no longer used. Drafts are now stored in separate Draft table.
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

export const IdentifierTypeValues = [
  'EMAIL',
  'PHONE',
  'FACEBOOK_PSID',
  'INSTAGRAM_IGSID',
  'CHAT_VISITOR',
] as const

export const InboxStatusValues = ['ACTIVE', 'ARCHIVED', 'PAUSED'] as const

export const IndexStatusValues = ['PENDING', 'INDEXED', 'ERROR'] as const

export const IntegrationSyncStageValues = [
  'IDLE',
  'MESSAGE_LIST_FETCH',
  'MESSAGES_IMPORT',
  'FAILED',
] as const

export const IntegrationSyncStatusValues = ['NOT_SYNCED', 'SYNCING', 'ACTIVE', 'FAILED'] as const

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

export const MachineMailTierValues = ['hard', 'soft'] as const

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
  'THREAD_SHARED',
  'SYSTEM_MESSAGE',
  'WORKFLOW_APPROVAL_REQUIRED',
  'WORKFLOW_APPROVAL_REMINDER',
  'WORKFLOW_APPROVAL_COMPLETED',
  'TASK_DEADLINE',
  'WORK_ORDER_DISPATCHED',
  'VISIT_RESCHEDULED',
  'VISIT_CANCELED',
  'VISIT_REASSIGNED',
  'TASK_AUTO_COMPLETED',
  'TASK_ASSIGNED',
  'RESOURCE_SHARED',
  'MESSAGE_SHARED',
  'ACCESS_REQUESTED',
  'ACCESS_REQUEST_DECIDED',
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

export const SendStatusValues = ['PENDING', 'SENT', 'FAILED', 'BOUNCED'] as const

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

export const SnippetPermissionValues = ['VIEW', 'EDIT'] as const

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

export const ThreadStatusValues = [
  'OPEN',
  'ARCHIVED',
  'ACTIVE',
  'RESOLVED',
  'PENDING',
  'CLOSED',
  'SPAM',
  'TRASH',
  'IGNORED',
] as const

export const ThreadTypeValues = ['EMAIL', 'CHAT'] as const

export const ThreadHandoffStateValues = ['ai', 'human'] as const

/** Thread handoff state — drives whether the AI agent replies on chat threads. */
export type ThreadHandoffState = (typeof ThreadHandoffStateValues)[number]

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

export const UserTypeValues = ['USER', 'SYSTEM', 'AGENT'] as const

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
export const EntityTypeValues = [
  'standard',
  'article',
  'catalog_group',
  'catalog_item',
  'company',
  'contact',
  'entity_group',
  'inbox',
  'invoice',
  'line_item',
  'meeting',
  'part',
  'payment',
  // See the `personal_inbox` note on `ModelTypeValues` above (plan 40 §3).
  'personal_inbox',
  'quote',
  'service_request',
  'signature',
  'stock_movement',
  'subpart',
  'tag',
  'thread',
  'ticket',
  'user',
  'vendor_part',
  'work_order',
] as const

export const StandardTypeValues = ['task', 'deal', 'custom'] as const

/**
 * System-seeded snippet markers (money MQ2 — `Snippet.systemType`). Stored as
 * plain text, not a pgEnum — the `EntityDefinition.entityType` precedent.
 * NULL for user-created snippets.
 */
export const SnippetSystemTypeValues = ['quote_email', 'invoice_email'] as const
export type SnippetSystemType = (typeof SnippetSystemTypeValues)[number]

export const SnippetSystemType = {
  quote_email: 'quote_email',
  invoice_email: 'invoice_email',
} as const

/**
 * `PaymentTransaction` ledger unions (money MI1 — 04-payments.md). Stored as plain text
 * columns, not pgEnums — the `EntityDefinition.entityType` precedent. Manual writers only
 * in MI1; the Stripe values ship dormant for MP1.
 */
export const PaymentProviderValues = ['manual', 'stripe'] as const
export type PaymentProvider = (typeof PaymentProviderValues)[number]

export const PaymentTransactionKindValues = ['charge', 'refund'] as const
export type PaymentTransactionKind = (typeof PaymentTransactionKindValues)[number]

export const PaymentTransactionStatusValues = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'canceled',
  'refunded',
  'disputed',
] as const
export type PaymentTransactionStatus = (typeof PaymentTransactionStatusValues)[number]

/**
 * `PaymentAccount.accountType` (money MP1 — 07-mp1-build.md §A.1). `express` is reserved for
 * a later markup-pricing milestone (MP2) — v1 only ever provisions `standard`.
 */
export const PaymentAccountTypeValues = ['standard', 'express'] as const
export type PaymentAccountType = (typeof PaymentAccountTypeValues)[number]

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
  withdrawn: 'withdrawn',
  superseded: 'superseded',
} as const

export const ApprovalKind = {
  workflow: 'workflow',
  access: 'access',
} as const

export const ArticleStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const

export const ArticleKind = {
  page: 'page',
  category: 'category',
  header: 'header',
  tab: 'tab',
  link: 'link',
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
  CALC: 'CALC',
  ACTOR: 'ACTOR',
  JSON: 'JSON',
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

// @deprecated - DraftMode is no longer used. Drafts are now stored in separate Draft table.
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
  CHAT_VISITOR: 'CHAT_VISITOR',
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

export const IntegrationSyncStage = {
  IDLE: 'IDLE',
  MESSAGE_LIST_FETCH: 'MESSAGE_LIST_FETCH',
  MESSAGES_IMPORT: 'MESSAGES_IMPORT',
  FAILED: 'FAILED',
} as const

export const IntegrationSyncStatus = {
  NOT_SYNCED: 'NOT_SYNCED',
  SYNCING: 'SYNCING',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
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
  imap: 'imap',
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

export const MachineMailTier = {
  hard: 'hard',
  soft: 'soft',
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
  THREAD_SHARED: 'THREAD_SHARED',
  SYSTEM_MESSAGE: 'SYSTEM_MESSAGE',
  WORKFLOW_APPROVAL_REQUIRED: 'WORKFLOW_APPROVAL_REQUIRED',
  WORKFLOW_APPROVAL_REMINDER: 'WORKFLOW_APPROVAL_REMINDER',
  WORKFLOW_APPROVAL_COMPLETED: 'WORKFLOW_APPROVAL_COMPLETED',
  TASK_DEADLINE: 'TASK_DEADLINE',
  WORK_ORDER_DISPATCHED: 'WORK_ORDER_DISPATCHED',
  VISIT_RESCHEDULED: 'VISIT_RESCHEDULED',
  VISIT_CANCELED: 'VISIT_CANCELED',
  VISIT_REASSIGNED: 'VISIT_REASSIGNED',
  TASK_AUTO_COMPLETED: 'TASK_AUTO_COMPLETED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  RESOURCE_SHARED: 'RESOURCE_SHARED',
  MESSAGE_SHARED: 'MESSAGE_SHARED',
  ACCESS_REQUESTED: 'ACCESS_REQUESTED',
  ACCESS_REQUEST_DECIDED: 'ACCESS_REQUEST_DECIDED',
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
  BOUNCED: 'BOUNCED',
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

export const SnippetPermission = {
  VIEW: 'VIEW',
  EDIT: 'EDIT',
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

export const ThreadStatus = {
  OPEN: 'OPEN',
  ARCHIVED: 'ARCHIVED',
  ACTIVE: 'ACTIVE',
  RESOLVED: 'RESOLVED',
  PENDING: 'PENDING',
  CLOSED: 'CLOSED',
  SPAM: 'SPAM',
  TRASH: 'TRASH',
  IGNORED: 'IGNORED',
} as const

export const ThreadHandoffState = {
  AI: 'ai',
  HUMAN: 'human',
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
  AGENT: 'AGENT',
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
  ARTICLE: 'article',
  CATALOG_GROUP: 'catalog_group',
  CATALOG_ITEM: 'catalog_item',
  COMPANY: 'company',
  CONTACT: 'contact',
  ENTITY_GROUP: 'entity_group',
  INBOX: 'inbox',
  INVOICE: 'invoice',
  LINE_ITEM: 'line_item',
  MEETING: 'meeting',
  PART: 'part',
  PAYMENT: 'payment',
  PERSONAL_INBOX: 'personal_inbox',
  QUOTE: 'quote',
  SERVICE_REQUEST: 'service_request',
  SIGNATURE: 'signature',
  STOCK_MOVEMENT: 'stock_movement',
  SUBPART: 'subpart',
  TAG: 'tag',
  THREAD: 'thread',
  TICKET: 'ticket',
  USER: 'user',
  VENDOR_PART: 'vendor_part',
  WORK_ORDER: 'work_order',
} as const

export const StandardType = {
  TASK: 'task',
  DEAL: 'deal',
  CUSTOM: 'custom',
} as const

// ============================================================================
// ENTITY GROUP ENUMS
// ============================================================================

/** Member type for EntityGroupMember - discriminator for memberRefId */
export const MemberTypeValues = ['entity', 'user'] as const
export type MemberType = (typeof MemberTypeValues)[number]

export const MemberType = {
  entity: 'entity',
  user: 'user',
} as const

/** Visibility for entity groups */
export const GroupVisibilityValues = ['public', 'private'] as const
export type GroupVisibility = (typeof GroupVisibilityValues)[number]

export const GroupVisibility = {
  public: 'public',
  private: 'private',
} as const

// ============================================================================
// RESOURCE ACCESS ENUMS
// ============================================================================

/**
 * Built-in entity definition identifiers for system resources.
 * These are used as entityDefinitionId values for non-custom entities.
 *
 * Custom entities use their actual EntityDefinition.id (CUID) instead.
 */
export const BuiltInEntityTypeValues = [
  'inbox',
  // Plan 40 §3 — personal mailboxes are their own EntityDefinition, but their
  // `ResourceAccess` rows stay SLUG-keyed exactly like `inbox`'s (the sharing
  // keyspace, not the CUID restriction keyspace — see the `entityDefinitionId`
  // doc on `db/schema/resource-access.ts`). Missing here, the grant vocabulary
  // has no name for a personal-inbox share and nothing fails loudly.
  'personal_inbox',
  'snippet',
  'folder',
  'workflow',
  'document',
] as const
export type BuiltInEntityType = (typeof BuiltInEntityTypeValues)[number]

export const BuiltInEntityType = {
  inbox: 'inbox',
  personal_inbox: 'personal_inbox',
  snippet: 'snippet',
  folder: 'folder',
  workflow: 'workflow',
  document: 'document',
} as const

/**
 * Grantee types for resource access. The column is plain `text()`, not a pgEnum,
 * so extending this union needs NO DB migration.
 *
 * `'profile'` (`granteeId` = `PermissionProfile.id`) is part of the vocabulary so
 * per-def / per-instance grants can target a permission profile — but note
 * `ResourceAccess` **writes** for this kind are refused until plan 19 step 9
 * updates every resolver (`assertProfileGranteeSupported` in
 * `resource-access-service.ts`). Only `PermissionGrant` (area levels) reads
 * profile grantees today. See plans/permissions/v2/19-permission-profiles.md §8.2.
 */
export const ResourceGranteeTypeValues = ['group', 'user', 'team', 'role', 'profile'] as const
export type ResourceGranteeType = (typeof ResourceGranteeTypeValues)[number]

export const ResourceGranteeType = {
  group: 'group',
  user: 'user',
  team: 'team',
  role: 'role',
  profile: 'profile',
} as const

/**
 * The grantee kinds every ResourceAccess **sharing** surface supports today —
 * `ResourceGranteeType` minus `'profile'`.
 *
 * `'profile'` is in the storage vocabulary but its writes are refused
 * (`assertProfileGranteeSupported`) until plan 19 step 9 teaches all four resolvers
 * and the sharing UIs to read it. Client hooks and pickers should type against THIS
 * union so a profile value can never reach a router whose input enum would reject
 * it — and so the compiler flags every surface that still needs updating when the
 * two unions are merged.
 */
export const SharingGranteeTypeValues = ['group', 'user', 'team', 'role'] as const
export type SharingGranteeType = (typeof SharingGranteeTypeValues)[number]

/**
 * Permission levels for resource access - hierarchical.
 *
 * `none` is a baseline-only marker used by the entity-def Access UI (capability
 * layer v2 phase 3): a single `role:org_member @ none` type row marks a def
 * restricted while granting nobody access, so only explicit team/member grants
 * can see it. It is deliberately NOT part of the view/edit/admin hierarchy
 * ({@link satisfiesPermission} never treats it as satisfying any requirement)
 * and is skipped when composing `defAccess`. The column is `text()`, not a
 * pgEnum, so extending this union needs no DB migration.
 */
export const ResourcePermissionValues = ['none', 'view', 'edit', 'admin'] as const
export type ResourcePermission = (typeof ResourcePermissionValues)[number]

export const ResourcePermission = {
  none: 'none',
  view: 'view',
  edit: 'edit',
  admin: 'admin',
} as const

/**
 * One instance-grant **rung** — the single ordinal ladder every
 * `ResourceAccess.rung` value is drawn from (plan v3/03 §2).
 *
 * ```
 * none < metadata < identity < read < edit < admin
 * ```
 *
 * The NAME is what persists; the ordinal (`RUNG_ORDER`) and every comparator
 * live in `@auxx/lib/permissions/capabilities/rung`, which re-exports this type.
 * The declaration sits HERE, beside {@link ResourcePermission}, for exactly the
 * reason that one does: `packages/database` is tier 1 and cannot import
 * `@auxx/lib` (tier 3), but `resource-access.ts` needs the type for
 * `text().$type<Rung>()`.
 *
 * `text()` + a CHECK constraint, deliberately not a `pgEnum`: `ALTER TYPE ADD
 * VALUE` cannot insert a value BETWEEN two existing ones, and this ladder is
 * expected to grow inward (mail already retro-fitted `metadata`/`identity`
 * between existing tiers once; a Docs-style `commenter` between `read` and
 * `edit` is the plausible next one). Adding a rung must stay a code change plus
 * one CHECK swap, never a renumbering migration over persisted rows.
 *
 * ⚠ **`none` is a RESTRICTION marker, never a grant** — see
 * `project_permission_none_is_a_restriction`.
 */
export const RungValues = ['none', 'metadata', 'identity', 'read', 'edit', 'admin'] as const
export type Rung = (typeof RungValues)[number]

/*
 * NOTE — deliberately NO `export const Rung = { none: 'none', … }` companion
 * object, unlike {@link ResourcePermission} above.
 *
 * That pattern buys `ResourcePermission.view` in place of `'view'`, and its only
 * real value is grep-ability on a vocabulary whose members are also common
 * English words. `Rung`'s members are ORDINAL and are compared through
 * `RUNG_ORDER` / `satisfiesRung`, never spelled out for their own sake — and the
 * const-object form would have made the ladder look like an unordered enum,
 * which is exactly the reading `Rung` exists to replace. Use the literals;
 * `RungValues` is there for the runtime list (zod enums, `IN (...)` builders).
 */

/**
 * Member seat type — packaging/billing identity, decoupled from `role` authority.
 * `worker` (UI: "Field seat") locks the member to a tiny capability ceiling so it
 * can be priced below a full seat. Invariant: `worker` ⇒ role `USER`.
 * See plans/permissions/capability-layer-and-worker-seat.md §2.A.
 */
export const SeatTypeValues = ['full', 'worker'] as const
export type SeatType = (typeof SeatTypeValues)[number]

export const SeatType = {
  full: 'full',
  worker: 'worker',
} as const

// ============================================================================
// ACTOR FIELD ENUMS
// ============================================================================

/** Target type for ACTOR fields - determines what kind of entity the actor references.
 * `worker` targets dispatch `DispatchWorker` rows (individuals + teams — 45-teams.md §5A). */
export const ActorTargetValues = ['user', 'group', 'worker', 'both'] as const
export type ActorTarget = (typeof ActorTargetValues)[number]

export const ActorTarget = {
  user: 'user',
  group: 'group',
  both: 'both',
} as const
