// import {
//   pgTable,
//   type AnyPgColumn,
//   uniqueIndex,
//   index,
//   foreignKey,
//   text,
//   bigint,
//   boolean,
//   timestamp,
//   integer,
//   jsonb,
//   varchar,
//   vector,
//   doublePrecision,
//   bigserial,
//   date,
//   primaryKey,
//   pgEnum,
// } from 'drizzle-orm/pg-core'
// import { sql } from 'drizzle-orm'

// export const actionType = pgEnum('ActionType', [
//   'ARCHIVE',
//   'LABEL',
//   'REPLY',
//   'FORWARD',
//   'MARK_SPAM',
//   'DRAFT_EMAIL',
//   'SEND_MESSAGE',
//   'APPLY_TAG',
//   'REMOVE_TAG',
//   'APPLY_LABEL',
//   'REMOVE_LABEL',
//   'MARK_TRASH',
//   'ASSIGN_THREAD',
//   'ARCHIVE_THREAD',
//   'UNARCHIVE_THREAD',
//   'MOVE_TO_TRASH',
//   'REACT_TO_MESSAGE',
//   'SHARE_MESSAGE',
//   'SEND_SMS',
//   'MAKE_CALL',
//   'ESCALATE',
//   'ASSIGN',
//   'NOTIFY',
//   'CREATE_TICKET',
//   'SHOPIFY_ORDER_LOOKUP',
//   'SHOPIFY_GENERATE_RESPONSE',
// ])
// export const aiIntegrationStatus = pgEnum('AiIntegrationStatus', ['PENDING', 'VALID', 'INVALID'])
// export const approvalAction = pgEnum('ApprovalAction', ['approve', 'deny'])
// export const approvalStatus = pgEnum('ApprovalStatus', ['pending', 'approved', 'denied', 'timeout'])
// export const articleStatus = pgEnum('ArticleStatus', ['DRAFT', 'PUBLISHED', 'ARCHIVED'])
// export const assetVersionStatus = pgEnum('AssetVersionStatus', [
//   'PENDING',
//   'PROCESSING',
//   'READY',
//   'FAILED',
// ])
// export const billingCycle = pgEnum('BillingCycle', ['MONTHLY', 'ANNUAL'])
// export const chunkingStrategy = pgEnum('ChunkingStrategy', [
//   'FIXED_SIZE',
//   'SEMANTIC',
//   'SENTENCE',
//   'PARAGRAPH',
//   'DOCUMENT',
// ])
// export const contactFieldType = pgEnum('ContactFieldType', [
//   'PHONE',
//   'EMAIL',
//   'ADDRESS',
//   'URL',
//   'TAGS',
//   'DATE',
//   'CHECKBOX',
//   'TEXT',
//   'NUMBER',
//   'MULTI_SELECT',
//   'SINGLE_SELECT',
//   'RICH_TEXT',
//   'PHONE_INTL',
//   'ADDRESS_STRUCT',
//   'FILE',
//   'NAME',
// ])
// export const customerSourceType = pgEnum('CustomerSourceType', [
//   'EMAIL',
//   'TICKET_SYSTEM',
//   'SHOPIFY',
//   'MANUAL',
//   'OTHER',
//   'FACEBOOK_PSID',
// ])
// export const customerStatus = pgEnum('CustomerStatus', ['ACTIVE', 'INACTIVE', 'SPAM', 'MERGED'])
// export const dataModelType = pgEnum('DataModelType', [
//   'CONTACT',
//   'COMPANY',
//   'CONVERSATION',
//   'TICKET',
// ])
// export const datasetStatus = pgEnum('DatasetStatus', ['ACTIVE', 'INACTIVE', 'PROCESSING', 'ERROR'])
// export const deliveryStatus = pgEnum('DeliveryStatus', [
//   'DELIVERED',
//   'BOUNCED',
//   'DELAYED',
//   'DEFERRED',
//   'REJECTED',
// ])
// export const documentStatus = pgEnum('DocumentStatus', [
//   'UPLOADED',
//   'PROCESSING',
//   'INDEXED',
//   'FAILED',
//   'ARCHIVED',
//   'WAITING',
// ])
// export const documentType = pgEnum('DocumentType', [
//   'PDF',
//   'DOCX',
//   'TXT',
//   'HTML',
//   'MARKDOWN',
//   'CSV',
//   'JSON',
//   'XML',
// ])
// export const domainType = pgEnum('DomainType', ['CUSTOM', 'PROVIDER'])
// export const draftMode = pgEnum('DraftMode', ['NONE', 'PRIVATE', 'SHARED'])
// export const emailLabel = pgEnum('EmailLabel', ['inbox', 'sent', 'draft'])
// export const emailProvider = pgEnum('EmailProvider', ['GMAIL', 'OUTLOOK', 'IMAP'])
// export const emailTemplateType = pgEnum('EmailTemplateType', [
//   'TICKET_CREATED',
//   'TICKET_REPLIED',
//   'TICKET_CLOSED',
//   'TICKET_REOPENED',
//   'TICKET_ASSIGNED',
//   'TICKET_STATUS_CHANGED',
//   'CUSTOM',
// ])
// export const extractionRuleType = pgEnum('ExtractionRuleType', [
//   'REGEX',
//   'MARKER',
//   'POSITION',
//   'AI_ASSISTED',
//   'VISUAL_SELECTION',
// ])
// export const fulfillmentStatus = pgEnum('FULFILLMENT_STATUS', [
//   'CANCELLED',
//   'ERROR',
//   'FAILURE',
//   'SUCCESS',
//   'OPEN',
//   'PENDING',
// ])
// export const fileStatus = pgEnum('FileStatus', [
//   'PENDING',
//   'CONFIRMED',
//   'ARCHIVED',
//   'DELETED',
//   'FAILED',
// ])
// export const fileVisibility = pgEnum('FileVisibility', ['PUBLIC', 'PRIVATE', 'INTERNAL'])
// export const inventoryPolicy = pgEnum('INVENTORY_POLICY', ['CONTINUE', 'DENY'])
// export const identifierType = pgEnum('IdentifierType', [
//   'EMAIL',
//   'PHONE',
//   'FACEBOOK_PSID',
//   'INSTAGRAM_IGSID',
// ])
// export const inboxStatus = pgEnum('InboxStatus', ['ACTIVE', 'ARCHIVED', 'PAUSED'])
// export const indexStatus = pgEnum('IndexStatus', ['PENDING', 'INDEXED', 'ERROR'])
// export const integrationAuthStatus = pgEnum('IntegrationAuthStatus', [
//   'AUTHENTICATED',
//   'UNAUTHENTICATED',
//   'ERROR',
//   'INVALID_GRANT',
//   'EXPIRED_TOKEN',
//   'REVOKED_ACCESS',
//   'INSUFFICIENT_SCOPE',
//   'RATE_LIMITED',
//   'PROVIDER_ERROR',
//   'NETWORK_ERROR',
//   'UNKNOWN_ERROR',
// ])
// export const integrationProviderType = pgEnum('IntegrationProviderType', [
//   'google',
//   'outlook',
//   'facebook',
//   'instagram',
//   'openphone',
//   'mailgun',
//   'sms',
//   'whatsapp',
//   'chat',
//   'email',
//   'shopify',
// ])
// export const integrationType = pgEnum('IntegrationType', [
//   'GOOGLE',
//   'OUTLOOK',
//   'OPENPHONE',
//   'FACEBOOK',
//   'INSTAGRAM',
//   'CHAT',
// ])
// export const invitationStatus = pgEnum('InvitationStatus', [
//   'PENDING',
//   'ACCEPTED',
//   'EXPIRED',
//   'CANCELLED',
// ])
// export const invoiceStatus = pgEnum('InvoiceStatus', [
//   'PENDING',
//   'PAID',
//   'VOID',
//   'UNCOLLECTIBLE',
//   'DRAFT',
// ])
// export const jobStatus = pgEnum('JobStatus', [
//   'PENDING',
//   'PROCESSING',
//   'COMPLETED_SUCCESS',
//   'COMPLETED_PARTIAL',
//   'COMPLETED_FAILURE',
//   'FAILED',
//   'RETRYING',
// ])
// export const labelType = pgEnum('LabelType', ['system', 'user'])
// export const mediaContentType = pgEnum('MEDIA_CONTENT_TYPE', [
//   'EXTERNAL_VIDEO',
//   'IMAGE',
//   'MODEL_3D',
//   'VIDEO',
// ])
// export const meetingMessageMethod = pgEnum('MeetingMessageMethod', [
//   'request',
//   'reply',
//   'cancel',
//   'counter',
//   'other',
// ])
// export const messageType = pgEnum('MessageType', [
//   'EMAIL',
//   'FACEBOOK',
//   'SMS',
//   'WHATSAPP',
//   'INSTAGRAM',
//   'OPENPHONE',
//   'CHAT',
// ])
// export const modelType = pgEnum('ModelType', [
//   'LLM',
//   'TEXT_EMBEDDING',
//   'RERANK',
//   'TTS',
//   'SPEECH2TEXT',
//   'MODERATION',
//   'VISION',
// ])
// export const nodeExecutionStatus = pgEnum('NodeExecutionStatus', [
//   'pending',
//   'running',
//   'succeeded',
//   'failed',
//   'exception',
//   'skipped',
//   'stopped',
//   'waiting',
// ])
// export const nodeTriggerSource = pgEnum('NodeTriggerSource', ['SINGLE_STEP', 'WORKFLOW_RUN'])
// export const notificationType = pgEnum('NotificationType', [
//   'COMMENT_MENTION',
//   'COMMENT_REPLY',
//   'COMMENT_REACTION',
//   'TICKET_ASSIGNED',
//   'TICKET_UPDATED',
//   'TICKET_MENTIONED',
//   'THREAD_ACTIVITY',
//   'SYSTEM_MESSAGE',
//   'WORKFLOW_APPROVAL_REQUIRED',
//   'WORKFLOW_APPROVAL_REMINDER',
//   'WORKFLOW_APPROVAL_COMPLETED',
// ])
// export const orderAddressType = pgEnum('ORDER_ADDRESS_TYPE', ['SHIPPING', 'BILLING'])
// export const orderCancelReason = pgEnum('ORDER_CANCEL_REASON', [
//   'CUSTOMER',
//   'DECLINED',
//   'FRAUD',
//   'INVENTORY',
//   'OTHER',
//   'STAFF',
// ])
// export const orderFinancialStatus = pgEnum('ORDER_FINANCIAL_STATUS', [
//   'AUTHORIZED',
//   'EXPIRED',
//   'PAID',
//   'PARTIALLY_PAID',
//   'PARTIALLY_REFUNDED',
//   'PENDING',
//   'REFUNDED',
//   'VOIDED',
// ])
// export const orderFulfillmentStatus = pgEnum('ORDER_FULFILLMENT_STATUS', [
//   'FULFILLED',
//   'IN_PROGRESS',
//   'ON_HOLD',
//   'OPEN',
//   'PARTIALLY_FULFILLED',
//   'PENDING_FULFILLMENT',
//   'REQUEST_DECLINED',
//   'RESTOCKED',
//   'SCHEDULED',
//   'UNFULFILLED',
// ])
// export const orderReturnStatus = pgEnum('ORDER_RETURN_STATUS', [
//   'INSPECTION_COMPLETED',
//   'IN_PROGRESS',
//   'NO_RETURN',
//   'RETURNED',
//   'RETURN_FAILED',
//   'RETURN_REQUESTED',
// ])
// export const organizationMemberStatus = pgEnum('OrganizationMemberStatus', ['ACTIVE', 'INACTIVE'])
// export const organizationRole = pgEnum('OrganizationRole', ['OWNER', 'ADMIN', 'USER'])
// export const organizationType = pgEnum('OrganizationType', ['INDIVIDUAL', 'TEAM'])
// export const produdtStatus = pgEnum('PRODUDT_STATUS', ['ACTIVE', 'ARCHIVED', 'DRAFT'])
// export const participantRole = pgEnum('ParticipantRole', ['FROM', 'TO', 'CC', 'BCC', 'REPLY_TO'])
// export const proposedActionStatus = pgEnum('ProposedActionStatus', [
//   'PENDING',
//   'APPROVED',
//   'REJECTED',
//   'EXECUTED',
//   'FAILED',
// ])
// export const providerQuotaType = pgEnum('ProviderQuotaType', ['PAID', 'FREE', 'TRIAL'])
// export const providerType = pgEnum('ProviderType', ['SYSTEM', 'CUSTOM'])
// export const returnStatus = pgEnum('RETURN_STATUS', [
//   'CANCELLED',
//   'CLOSED',
//   'DECLINED',
//   'OPEN',
//   'REQUESTED',
// ])
// export const recipientRole = pgEnum('RecipientRole', ['FROM', 'TO', 'CC', 'BCC'])
// export const responseStatus = pgEnum('ResponseStatus', [
//   'DRAFT',
//   'PENDING_APPROVAL',
//   'APPROVED',
//   'SCHEDULED',
//   'SENDING',
//   'SENT',
//   'FAILED',
//   'CANCELLED',
// ])
// export const responseType = pgEnum('ResponseType', [
//   'MANUAL',
//   'TEMPLATE',
//   'AI_GENERATED',
//   'RULE_BASED',
//   'HYBRID',
// ])
// export const ruleGroupOperator = pgEnum('RuleGroupOperator', [
//   'AND',
//   'OR',
//   'NOT',
//   'XOR',
//   'THRESHOLD',
// ])
// export const ruleType = pgEnum('RuleType', [
//   'STATIC',
//   'CATEGORY',
//   'AI',
//   'SPAM_HANDLER',
//   'RULE_GROUP',
//   'SHOPIFY_AUTOMATION',
// ])
// export const syncStatus = pgEnum('SYNC_STATUS', ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'])
// export const sendStatus = pgEnum('SendStatus', ['PENDING', 'SENT', 'FAILED'])
// export const senderType = pgEnum('SenderType', [
//   'INTERNAL_STAFF',
//   'INTERNAL_SYSTEM',
//   'PARTNER',
//   'CUSTOMER',
//   'VENDOR',
//   'UNKNOWN_EXTERNAL',
// ])
// export const sensitivity = pgEnum('Sensitivity', ['normal', 'private', 'personal', 'confidential'])
// export const settingScope = pgEnum('SettingScope', [
//   'APPEARANCE',
//   'NOTIFICATION',
//   'DASHBOARD',
//   'COMMUNICATION',
//   'SECURITY',
//   'INTEGRATION',
//   'GENERAL',
//   'SIDEBAR',
// ])
// export const signatureSharingType = pgEnum('SignatureSharingType', [
//   'PRIVATE',
//   'ORGANIZATION_WIDE',
//   'SPECIFIC_INTEGRATIONS',
// ])
// export const snippetPermission = pgEnum('SnippetPermission', ['VIEW', 'EDIT'])
// export const snippetSharingType = pgEnum('SnippetSharingType', [
//   'PRIVATE',
//   'ORGANIZATION',
//   'GROUPS',
//   'MEMBERS',
// ])
// export const staticRuleType = pgEnum('StaticRuleType', [
//   'SENDER_DOMAIN',
//   'SENDER_ADDRESS',
//   'RECIPIENT_PATTERN',
//   'SUBJECT_MATCH',
//   'BODY_KEYWORD',
//   'HEADER_CHECK',
//   'ATTACHMENT_TYPE',
//   'COMBINED',
//   'INTERNAL_EXTERNAL',
//   'THREAD_BASED',
// ])
// export const storageProvider = pgEnum('StorageProvider', [
//   'S3',
//   'GOOGLE_DRIVE',
//   'DROPBOX',
//   'ONEDRIVE',
//   'BOX',
//   'GENERIC_URL',
// ])
// export const subscriptionStatus = pgEnum('SubscriptionStatus', [
//   'ACTIVE',
//   'PAST_DUE',
//   'CANCELED',
//   'TRIALING',
//   'UNPAID',
// ])
// export const testCaseStatus = pgEnum('TestCaseStatus', ['ACTIVE', 'INACTIVE', 'DRAFT'])
// export const testRunStatus = pgEnum('TestRunStatus', [
//   'PENDING',
//   'RUNNING',
//   'COMPLETED',
//   'FAILED',
//   'CANCELLED',
// ])
// export const threadStatus = pgEnum('ThreadStatus', [
//   'OPEN',
//   'ARCHIVED',
//   'ACTIVE',
//   'RESOLVED',
//   'PENDING',
//   'CLOSED',
//   'SPAM',
//   'TRASH',
// ])

// export const threadType = pgEnum('ThreadType', ['EMAIL', 'CHAT'])
// export const ticketPriority = pgEnum('TicketPriority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
// export const ticketStatus = pgEnum('TicketStatus', [
//   'OPEN',
//   'IN_PROGRESS',
//   'WAITING_FOR_CUSTOMER',
//   'WAITING_FOR_THIRD_PARTY',
//   'RESOLVED',
//   'CLOSED',
//   'CANCELLED',
//   'MERGED',
// ])
// export const ticketType = pgEnum('TicketType', [
//   'GENERAL',
//   'MISSING_ITEM',
//   'RETURN',
//   'REFUND',
//   'PRODUCT_ISSUE',
//   'SHIPPING_ISSUE',
//   'BILLING',
//   'TECHNICAL',
//   'OTHER',
// ])
// export const trialConversionStatus = pgEnum('TrialConversionStatus', [
//   'TRIAL_ACTIVE',
//   'CONVERTED_TO_PAID',
//   'EXPIRED_WITHOUT_CONVERSION',
//   'CANCELED_DURING_TRIAL',
//   'MANUAL_CONVERSION',
// ])
// export const userType = pgEnum('UserType', ['USER', 'SYSTEM'])
// export const vectorDbType = pgEnum('VectorDbType', [
//   'POSTGRESQL',
//   'CHROMA',
//   'QDRANT',
//   'WEAVIATE',
//   'PINECONE',
//   'MILVUS',
// ])
// export const workflowRunStatus = pgEnum('WorkflowRunStatus', [
//   'RUNNING',
//   'SUCCEEDED',
//   'FAILED',
//   'STOPPED',
//   'WAITING',
// ])
// export const workflowTriggerSource = pgEnum('WorkflowTriggerSource', [
//   'DEBUGGING',
//   'APP_RUN',
//   'SINGLE_STEP',
// ])

// export const mediaAsset = pgTable(
//   'MediaAsset',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     kind: text().notNull(),
//     name: text(),
//     mimeType: text(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     size: bigint({ mode: 'number' }),
//     isPrivate: boolean().default(true).notNull(),
//     deletedAt: timestamp({ precision: 3, mode: 'string' }),
//     currentVersionId: text(),
//     createdById: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }),
//     purpose: text().default('ORIGINAL').notNull(),
//   },
//   (table) => [
//     uniqueIndex('MediaAsset_currentVersionId_key').using(
//       'btree',
//       table.currentVersionId.asc().nullsLast()
//     ),
//     index('MediaAsset_expiresAt_idx').using('btree', table.expiresAt.asc().nullsLast()),
//     uniqueIndex('MediaAsset_id_organizationId_key').using(
//       'btree',
//       table.id.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     index('MediaAsset_kind_isPrivate_idx').using(
//       'btree',
//       table.kind.asc().nullsLast(),
//       table.isPrivate.asc().nullsLast()
//     ),
//     index('MediaAsset_organizationId_expiresAt_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.expiresAt.asc().nullsLast()
//     ),
//     index('MediaAsset_organizationId_kind_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.kind.asc().nullsLast()
//     ),
//     index('MediaAsset_organizationId_purpose_kind_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.purpose.asc().nullsLast(),
//       table.kind.asc().nullsLast()
//     ),
//     index('idx_thumbnail_assets')
//       .using('btree', table.organizationId.asc().nullsLast(), table.kind.asc().nullsLast())
//       .where(sql`((kind = 'THUMBNAIL'::text) AND ("deletedAt" IS NULL))`),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'MediaAsset_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.currentVersionId],
//       foreignColumns: [mediaAssetVersion.id],
//       name: 'MediaAsset_currentVersionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'MediaAsset_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const mediaAssetVersion = pgTable(
//   'MediaAssetVersion',
//   {
//     id: text().primaryKey().notNull(),
//     assetId: text().notNull(),
//     versionNumber: integer().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     size: bigint({ mode: 'number' }),
//     mimeType: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     storageLocationId: text(),
//     deletedAt: timestamp({ precision: 3, mode: 'string' }),
//     derivedFromVersionId: text(),
//     preset: text(),
//     metadata: jsonb().default({}),
//     status: assetVersionStatus().default('PENDING').notNull(),
//   },
//   (table) => [
//     index('MediaAssetVersion_assetId_createdAt_idx').using(
//       'btree',
//       table.assetId.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     uniqueIndex('MediaAssetVersion_assetId_versionNumber_key').using(
//       'btree',
//       table.assetId.asc().nullsLast(),
//       table.versionNumber.asc().nullsLast()
//     ),
//     uniqueIndex('MediaAssetVersion_derivedFromVersionId_preset_key').using(
//       'btree',
//       table.derivedFromVersionId.asc().nullsLast(),
//       table.preset.asc().nullsLast()
//     ),
//     index('MediaAssetVersion_derivedFromVersionId_preset_status_idx').using(
//       'btree',
//       table.derivedFromVersionId.asc().nullsLast(),
//       table.preset.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     index('MediaAssetVersion_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('idx_thumbnail_cleanup')
//       .using('btree', table.derivedFromVersionId.asc().nullsLast())
//       .where(sql`(("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL))`),
//     index('idx_thumbnail_lookup_covering')
//       .using(
//         'btree',
//         table.derivedFromVersionId.asc().nullsLast(),
//         table.preset.asc().nullsLast(),
//         table.id.asc().nullsLast()
//       )
//       .where(sql`(("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL))`),
//     uniqueIndex('idx_unique_thumbnail')
//       .using('btree', table.derivedFromVersionId.asc().nullsLast(), table.preset.asc().nullsLast())
//       .where(sql`(("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL))`),
//     foreignKey({
//       columns: [table.assetId],
//       foreignColumns: [mediaAsset.id],
//       name: 'MediaAssetVersion_assetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.derivedFromVersionId],
//       foreignColumns: [table.id],
//       name: 'MediaAssetVersion_derivedFromVersionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.storageLocationId],
//       foreignColumns: [storageLocation.id],
//       name: 'MediaAssetVersion_storageLocationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const prismaMigrations = pgTable('_prisma_migrations', {
//   id: varchar({ length: 36 }).primaryKey().notNull(),
//   checksum: varchar({ length: 64 }).notNull(),
//   finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
//   migrationName: varchar('migration_name', { length: 255 }).notNull(),
//   logs: text(),
//   rolledBackAt: timestamp('rolled_back_at', { withTimezone: true, mode: 'string' }),
//   startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
//   appliedStepsCount: integer('applied_steps_count').default(0).notNull(),
// })

// export const emailAddress = pgTable(
//   'EmailAddress',
//   {
//     id: text().primaryKey().notNull(),
//     name: text(),
//     address: text().notNull(),
//     raw: text(),
//     integrationId: text().notNull(),
//     integrationType: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('EmailAddress_integrationId_address_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast(),
//       table.address.asc().nullsLast()
//     ),
//   ]
// )

// export const organization = pgTable(
//   'Organization',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text(),
//     website: text(),
//     about: text(),
//     emailDomain: text('email_domain'),
//     type: organizationType().default('TEAM').notNull(),
//     createdById: text().notNull(),
//     systemUserId: text(),
//     handle: text(),
//   },
//   (table) => [
//     index('Organization_handle_idx').using('btree', table.handle.asc().nullsLast()),
//     uniqueIndex('Organization_handle_key').using('btree', table.handle.asc().nullsLast()),
//     uniqueIndex('Organization_systemUserId_key').using(
//       'btree',
//       table.systemUserId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Organization_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.systemUserId],
//       foreignColumns: [user.id],
//       name: 'Organization_systemUserId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const organizationMember = pgTable(
//   'OrganizationMember',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     userId: text().notNull(),
//     organizationId: text().notNull(),
//     status: organizationMemberStatus().default('ACTIVE').notNull(),
//     role: organizationRole().default('USER').notNull(),
//   },
//   (table) => [
//     index('OrganizationMember_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('OrganizationMember_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     uniqueIndex('OrganizationMember_userId_organizationId_key').using(
//       'btree',
//       table.userId.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'OrganizationMember_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'OrganizationMember_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const organizationInvitation = pgTable(
//   'OrganizationInvitation',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     email: text().notNull(),
//     role: organizationRole().notNull(),
//     token: text().notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     status: invitationStatus().default('PENDING').notNull(),
//     organizationId: text().notNull(),
//     invitedById: text().notNull(),
//     acceptedById: text(),
//     acceptedAt: timestamp({ precision: 3, mode: 'string' }),
//   },
//   (table) => [
//     index('OrganizationInvitation_email_idx').using('btree', table.email.asc().nullsLast()),
//     index('OrganizationInvitation_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('OrganizationInvitation_status_idx').using('btree', table.status.asc().nullsLast()),
//     uniqueIndex('OrganizationInvitation_token_key').using('btree', table.token.asc().nullsLast()),
//     foreignKey({
//       columns: [table.acceptedById],
//       foreignColumns: [user.id],
//       name: 'OrganizationInvitation_acceptedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.invitedById],
//       foreignColumns: [user.id],
//       name: 'OrganizationInvitation_invitedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'OrganizationInvitation_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const group = pgTable(
//   'Group',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     description: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     properties: jsonb(),
//   },
//   (table) => [
//     uniqueIndex('Group_name_organizationId_key').using(
//       'btree',
//       table.name.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     index('Group_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Group_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const groupMember = pgTable(
//   'GroupMember',
//   {
//     id: text().primaryKey().notNull(),
//     groupId: text().notNull(),
//     userId: text().notNull(),
//     isActive: boolean().default(true).notNull(),
//     joinedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     deactivatedAt: timestamp({ precision: 3, mode: 'string' }),
//   },
//   (table) => [
//     index('GroupMember_groupId_idx').using('btree', table.groupId.asc().nullsLast()),
//     uniqueIndex('GroupMember_groupId_userId_key').using(
//       'btree',
//       table.groupId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     index('GroupMember_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.groupId],
//       foreignColumns: [group.id],
//       name: 'GroupMember_groupId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'GroupMember_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const organizationSetting = pgTable(
//   'OrganizationSetting',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     key: text().notNull(),
//     value: jsonb().notNull(),
//     allowUserOverride: boolean().default(false).notNull(),
//     scope: settingScope().default('GENERAL').notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('OrganizationSetting_key_idx').using('btree', table.key.asc().nullsLast()),
//     index('OrganizationSetting_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('OrganizationSetting_organizationId_key_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.key.asc().nullsLast()
//     ),
//     index('OrganizationSetting_scope_idx').using('btree', table.scope.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'OrganizationSetting_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const userSetting = pgTable(
//   'UserSetting',
//   {
//     id: text().primaryKey().notNull(),
//     userId: text().notNull(),
//     organizationSettingId: text().notNull(),
//     value: jsonb().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('UserSetting_organizationSettingId_idx').using(
//       'btree',
//       table.organizationSettingId.asc().nullsLast()
//     ),
//     index('UserSetting_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     uniqueIndex('UserSetting_userId_organizationSettingId_key').using(
//       'btree',
//       table.userId.asc().nullsLast(),
//       table.organizationSettingId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationSettingId],
//       foreignColumns: [organizationSetting.id],
//       name: 'UserSetting_organizationSettingId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'UserSetting_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const integrationSchedule = pgTable(
//   'IntegrationSchedule',
//   {
//     id: text().primaryKey().notNull(),
//     integrationId: text().notNull(),
//     workingHours: jsonb(),
//     outOfOffice: boolean().default(false).notNull(),
//     outOfOfficeStart: timestamp({ precision: 3, mode: 'string' }),
//     outOfOfficeEnd: timestamp({ precision: 3, mode: 'string' }),
//     outOfOfficeMessage: text(),
//     timeZone: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('IntegrationSchedule_integrationId_idx').using(
//       'btree',
//       table.integrationId.asc().nullsLast()
//     ),
//     uniqueIndex('IntegrationSchedule_integrationId_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [integration.id],
//       name: 'IntegrationSchedule_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const shopifyIntegration = pgTable(
//   'ShopifyIntegration',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     shopDomain: text().notNull(),
//     accessToken: text().notNull(),
//     scope: text().notNull(),
//     enabled: boolean().default(true).notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//   },
//   (table) => [
//     index('ShopifyIntegration_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('ShopifyIntegration_organizationId_shopDomain_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.shopDomain.asc().nullsLast()
//     ),
//     index('ShopifyIntegration_shopDomain_idx').using('btree', table.shopDomain.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'ShopifyIntegration_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ShopifyIntegration_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const shopifyAuthState = pgTable(
//   'ShopifyAuthState',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     userId: text().notNull(),
//     organizationId: text().notNull(),
//     state: text().notNull(),
//     shopDomain: text().notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('ShopifyAuthState_state_idx').using('btree', table.state.asc().nullsLast()),
//     index('ShopifyAuthState_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ShopifyAuthState_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'ShopifyAuthState_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const contact = pgTable(
//   'Contact',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     status: customerStatus().default('ACTIVE').notNull(),
//     email: text(),
//     emails: text().array(),
//     firstName: text(),
//     lastName: text(),
//     phone: text(),
//     notes: text(),
//     tags: text().array(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     index('Contact_emails_idx').using('gin', table.emails.asc().nullsLast()),
//     uniqueIndex('Contact_organizationId_email_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.email.asc().nullsLast()
//     ),
//     index('Contact_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Contact_organizationId_phone_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.phone.asc().nullsLast()
//     ),
//     index('Contact_organizationId_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Contact_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const customerSource = pgTable(
//   'CustomerSource',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     source: customerSourceType().default('EMAIL').notNull(),
//     sourceId: text().notNull(),
//     email: text(),
//     sourceData: jsonb(),
//     organizationId: text().notNull(),
//     contactId: text().notNull(),
//   },
//   (table) => [
//     index('CustomerSource_contactId_idx').using('btree', table.contactId.asc().nullsLast()),
//     index('CustomerSource_email_idx').using('btree', table.email.asc().nullsLast()),
//     index('CustomerSource_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('CustomerSource_source_sourceId_organizationId_key').using(
//       'btree',
//       table.source.asc().nullsLast(),
//       table.sourceId.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.contactId],
//       foreignColumns: [contact.id],
//       name: 'CustomerSource_contactId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'CustomerSource_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const customerGroup = pgTable(
//   'CustomerGroup',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text().notNull(),
//     description: text(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('CustomerGroup_name_organizationId_key').using(
//       'btree',
//       table.name.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     index('CustomerGroup_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'CustomerGroup_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const customerGroupMember = pgTable(
//   'CustomerGroupMember',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     customerGroupId: text().notNull(),
//     contactId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('CustomerGroupMember_customerGroupId_contactId_key').using(
//       'btree',
//       table.customerGroupId.asc().nullsLast(),
//       table.contactId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.contactId],
//       foreignColumns: [contact.id],
//       name: 'CustomerGroupMember_contactId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.customerGroupId],
//       foreignColumns: [customerGroup.id],
//       name: 'CustomerGroupMember_customerGroupId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const participant = pgTable(
//   'Participant',
//   {
//     id: text().primaryKey().notNull(),
//     identifier: text().notNull(),
//     identifierType: identifierType().notNull(),
//     name: text(),
//     displayName: text(),
//     initials: text(),
//     isSpammer: boolean().default(false).notNull(),
//     contactId: text(),
//     organizationId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     firstInteractionDate: timestamp({ precision: 3, mode: 'string' }),
//     firstInteractionType: text(),
//     hasReceivedMessage: boolean().default(false).notNull(),
//     lastSentMessageAt: timestamp({ precision: 3, mode: 'string' }),
//   },
//   (table) => [
//     index('Participant_contactId_idx').using('btree', table.contactId.asc().nullsLast()),
//     index('Participant_identifierType_idx').using('btree', table.identifierType.asc().nullsLast()),
//     index('Participant_identifier_idx').using('btree', table.identifier.asc().nullsLast()),
//     uniqueIndex('Participant_organizationId_identifier_identifierType_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.identifier.asc().nullsLast(),
//       table.identifierType.asc().nullsLast()
//     ),
//     index('Participant_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.contactId],
//       foreignColumns: [contact.id],
//       name: 'Participant_contactId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Participant_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const verificationToken = pgTable(
//   'VerificationToken',
//   {
//     id: text().primaryKey().notNull(),
//     token: text().notNull(),
//     userId: text().notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('VerificationToken_token_key').using('btree', table.token.asc().nullsLast()),
//     index('VerificationToken_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'VerificationToken_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const passwordResetToken = pgTable(
//   'PasswordResetToken',
//   {
//     id: text().primaryKey().notNull(),
//     token: text().notNull(),
//     userId: text().notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('PasswordResetToken_token_key').using('btree', table.token.asc().nullsLast()),
//     index('PasswordResetToken_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'PasswordResetToken_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const inbox = pgTable(
//   'Inbox',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text().notNull(),
//     description: text(),
//     color: text().default('#4F46E5'),
//     status: inboxStatus().default('ACTIVE').notNull(),
//     settings: jsonb().default({}),
//     allowAllMembers: boolean().default(true).notNull(),
//     enableMemberAccess: boolean().default(false).notNull(),
//     enableGroupAccess: boolean().default(false).notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     index('Inbox_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     uniqueIndex('Inbox_organizationId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Inbox_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const inboxIntegration = pgTable(
//   'InboxIntegration',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     settings: jsonb().default({}),
//     isDefault: boolean().default(false).notNull(),
//     inboxId: text().notNull(),
//     integrationId: text().notNull(),
//   },
//   (table) => [
//     index('InboxIntegration_inboxId_idx').using('btree', table.inboxId.asc().nullsLast()),
//     uniqueIndex('InboxIntegration_inboxId_integrationId_key').using(
//       'btree',
//       table.inboxId.asc().nullsLast(),
//       table.integrationId.asc().nullsLast()
//     ),
//     uniqueIndex('InboxIntegration_integrationId_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.inboxId],
//       foreignColumns: [inbox.id],
//       name: 'InboxIntegration_inboxId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [integration.id],
//       name: 'InboxIntegration_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const inboxMemberAccess = pgTable(
//   'InboxMemberAccess',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     inboxId: text().notNull(),
//     organizationMemberId: text().notNull(),
//   },
//   (table) => [
//     index('InboxMemberAccess_inboxId_idx').using('btree', table.inboxId.asc().nullsLast()),
//     uniqueIndex('InboxMemberAccess_inboxId_organizationMemberId_key').using(
//       'btree',
//       table.inboxId.asc().nullsLast(),
//       table.organizationMemberId.asc().nullsLast()
//     ),
//     index('InboxMemberAccess_organizationMemberId_idx').using(
//       'btree',
//       table.organizationMemberId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.inboxId],
//       foreignColumns: [inbox.id],
//       name: 'InboxMemberAccess_inboxId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationMemberId],
//       foreignColumns: [organizationMember.id],
//       name: 'InboxMemberAccess_organizationMemberId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const inboxGroupAccess = pgTable(
//   'InboxGroupAccess',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     inboxId: text().notNull(),
//     groupId: text().notNull(),
//   },
//   (table) => [
//     index('InboxGroupAccess_groupId_idx').using('btree', table.groupId.asc().nullsLast()),
//     uniqueIndex('InboxGroupAccess_inboxId_groupId_key').using(
//       'btree',
//       table.inboxId.asc().nullsLast(),
//       table.groupId.asc().nullsLast()
//     ),
//     index('InboxGroupAccess_inboxId_idx').using('btree', table.inboxId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.groupId],
//       foreignColumns: [group.id],
//       name: 'InboxGroupAccess_groupId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.inboxId],
//       foreignColumns: [inbox.id],
//       name: 'InboxGroupAccess_inboxId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const threadReadStatus = pgTable(
//   'ThreadReadStatus',
//   {
//     id: text().primaryKey().notNull(),
//     threadId: text().notNull(),
//     userId: text().notNull(),
//     organizationId: text().notNull(),
//     isRead: boolean().default(false).notNull(),
//     lastReadAt: timestamp({ precision: 3, mode: 'string' }),
//     lastSeenMessageId: text(),
//   },
//   (table) => [
//     index('ThreadReadStatus_isRead_idx').using('btree', table.isRead.asc().nullsLast()),
//     index('ThreadReadStatus_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('ThreadReadStatus_organizationId_userId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     index('ThreadReadStatus_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
//     uniqueIndex('ThreadReadStatus_threadId_userId_key').using(
//       'btree',
//       table.threadId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     index('ThreadReadStatus_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     index('ThreadReadStatus_userId_isRead_idx').using(
//       'btree',
//       table.userId.asc().nullsLast(),
//       table.isRead.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ThreadReadStatus_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'ThreadReadStatus_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'ThreadReadStatus_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const userInboxUnreadCount = pgTable(
//   'UserInboxUnreadCount',
//   {
//     id: text().primaryKey().notNull(),
//     inboxId: text().notNull(),
//     userId: text().notNull(),
//     organizationId: text().notNull(),
//     unreadCount: integer().default(0).notNull(),
//     lastUpdatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('UserInboxUnreadCount_inboxId_idx').using('btree', table.inboxId.asc().nullsLast()),
//     index('UserInboxUnreadCount_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('UserInboxUnreadCount_organizationId_inboxId_userId_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.inboxId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     index('UserInboxUnreadCount_organizationId_userId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     index('UserInboxUnreadCount_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.inboxId],
//       foreignColumns: [inbox.id],
//       name: 'UserInboxUnreadCount_inboxId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'UserInboxUnreadCount_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'UserInboxUnreadCount_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const label = pgTable(
//   'Label',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     integrationType: text().notNull(),
//     integrationId: text().notNull(),
//     labelId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     enabled: boolean().default(true).notNull(),
//     isVisible: boolean().default(true).notNull(),
//     backgroundColor: text(),
//     textColor: text(),
//     type: labelType().notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('Label_labelId_organizationId_integrationId_key').using(
//       'btree',
//       table.labelId.asc().nullsLast(),
//       table.organizationId.asc().nullsLast(),
//       table.integrationId.asc().nullsLast()
//     ),
//     uniqueIndex('Label_name_organizationId_integrationId_key').using(
//       'btree',
//       table.name.asc().nullsLast(),
//       table.organizationId.asc().nullsLast(),
//       table.integrationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Label_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const signature = pgTable(
//   'Signature',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     body: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     isDefault: boolean().default(false).notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//     sharingType: signatureSharingType().default('PRIVATE').notNull(),
//   },
//   (table) => [
//     index('Signature_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('Signature_isDefault_idx').using('btree', table.isDefault.asc().nullsLast()),
//     index('Signature_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Signature_sharingType_idx').using('btree', table.sharingType.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Signature_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Signature_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailEmbedding = pgTable(
//   'EmailEmbedding',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     content: text().notNull(),
//     embedding: vector({ dimensions: 1536 }),
//     model: text().default('text-embedding-3-small').notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('EmailEmbedding_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailEmbedding_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const embeddingJobs = pgTable(
//   'embedding_jobs',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     status: text().notNull(),
//     collection: text().notNull(),
//     documents: jsonb().notNull(),
//     chunkingOptions: jsonb(),
//     documentCount: integer().notNull(),
//     processedCount: integer().default(0).notNull(),
//     errorCount: integer().default(0).notNull(),
//     error: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     completedAt: timestamp({ precision: 3, mode: 'string' }),
//   },
//   (table) => [
//     index('embedding_jobs_collection_idx').using('btree', table.collection.asc().nullsLast()),
//     index('embedding_jobs_status_idx').using('btree', table.status.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'embedding_jobs_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const embeddings = pgTable(
//   'embeddings',
//   {
//     id: text().primaryKey().notNull(),
//     jobId: text().notNull(),
//     collection: text().notNull(),
//     documentId: text().notNull(),
//     content: text().notNull(),
//     metadata: jsonb().notNull(),
//     embedding: jsonb().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('embeddings_collection_idx').using('btree', table.collection.asc().nullsLast()),
//     index('embeddings_documentId_idx').using('btree', table.documentId.asc().nullsLast()),
//     index('embeddings_jobId_idx').using('btree', table.jobId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.jobId],
//       foreignColumns: [embeddingJobs.id],
//       name: 'embeddings_jobId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailRuleMatch = pgTable(
//   'EmailRuleMatch',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     ruleId: text().notNull(),
//     matchedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('EmailRuleMatch_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     uniqueIndex('EmailRuleMatch_messageId_ruleId_key').using(
//       'btree',
//       table.messageId.asc().nullsLast(),
//       table.ruleId.asc().nullsLast()
//     ),
//     index('EmailRuleMatch_ruleId_idx').using('btree', table.ruleId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailRuleMatch_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'EmailRuleMatch_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const message = pgTable(
//   'Message',
//   {
//     id: text().primaryKey().notNull(),
//     externalId: text(),
//     externalThreadId: text(),
//     threadId: text().notNull(),
//     integrationId: text().notNull(),
//     integrationType: text().notNull(),
//     messageType: messageType().default('EMAIL').notNull(),
//     isInbound: boolean().default(true).notNull(),
//     isAutoReply: boolean().default(false).notNull(),
//     isFirstInThread: boolean().default(true).notNull(),
//     isAIGenerated: boolean().default(false).notNull(),
//     draftMode: draftMode().default('NONE').notNull(),
//     subject: text().notNull(),
//     textHtml: text(),
//     textPlain: text(),
//     internetMessageId: text(),
//     snippet: text(),
//     metadata: jsonb(),
//     createdById: text(),
//     organizationId: text().notNull(),
//     fromId: text().notNull(),
//     replyToId: text(),
//     isReply: boolean().default(false).notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     historyId: bigint({ mode: 'number' }),
//     createdTime: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     lastModifiedTime: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     sentAt: timestamp({ precision: 3, mode: 'string' }),
//     receivedAt: timestamp({ precision: 3, mode: 'string' }),
//     keywords: text().array(),
//     signatureId: text(),
//     hasAttachments: boolean().default(false).notNull(),
//     inReplyTo: text(),
//     references: text(),
//     threadIndex: text(),
//     internetHeaders: jsonb().array(),
//     folderId: text(),
//     emailLabel: emailLabel().default('inbox').notNull(),
//     attempts: integer().default(0).notNull(),
//     lastAttemptAt: timestamp({ precision: 3, mode: 'string' }),
//     providerError: text(),
//     sendStatus: sendStatus().default('SENT'),
//     sendToken: text(),
//   },
//   (table) => [
//     index('Message_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('Message_emailLabel_idx').using('btree', table.emailLabel.asc().nullsLast()),
//     index('Message_fromId_idx').using('btree', table.fromId.asc().nullsLast()),
//     uniqueIndex('Message_integrationId_externalId_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast(),
//       table.externalId.asc().nullsLast()
//     ),
//     index('Message_integrationId_idx').using('btree', table.integrationId.asc().nullsLast()),
//     index('Message_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     uniqueIndex('Message_organizationId_internetMessageId_key')
//       .using(
//         'btree',
//         table.organizationId.asc().nullsLast(),
//         table.internetMessageId.asc().nullsLast()
//       )
//       .where(sql`("internetMessageId" IS NOT NULL)`),
//     index('Message_replyToId_idx').using('btree', table.replyToId.asc().nullsLast()),
//     uniqueIndex('Message_sendToken_key')
//       .using('btree', table.sendToken.asc().nullsLast())
//       .where(sql`("sendToken" IS NOT NULL)`),
//     index('Message_sentAt_idx').using('btree', table.sentAt.asc().nullsLast()),
//     index('Message_threadId_createdById_draftMode_idx').using(
//       'btree',
//       table.threadId.asc().nullsLast(),
//       table.createdById.asc().nullsLast(),
//       table.draftMode.asc().nullsLast()
//     ),
//     index('Message_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
//     index('retry_queue_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.sendStatus.asc().nullsLast(),
//       table.lastAttemptAt.asc().nullsLast()
//     ),
//     index('thread_messages_idx').using(
//       'btree',
//       table.threadId.asc().nullsLast(),
//       table.draftMode.asc().nullsLast(),
//       table.sentAt.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Message_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.fromId],
//       foreignColumns: [participant.id],
//       name: 'Message_fromId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [integration.id],
//       name: 'Message_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Message_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.replyToId],
//       foreignColumns: [participant.id],
//       name: 'Message_replyToId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.signatureId],
//       foreignColumns: [signature.id],
//       name: 'Message_signatureId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'Message_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailAiAnalysis = pgTable(
//   'EmailAIAnalysis',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     organizationId: text().notNull(),
//     categories: text().array(),
//     isSpam: boolean().default(false).notNull(),
//     spamConfidence: doublePrecision().default(0).notNull(),
//     spamReason: text(),
//     needsResponse: boolean().default(false).notNull(),
//     responseUrgency: integer(),
//     suggestedResponseType: text(),
//     orderNumbers: text().array(),
//     trackingNumbers: text().array(),
//     productIds: text().array(),
//     kbDocumentIds: text().array(),
//     entities: jsonb(),
//     model: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('EmailAIAnalysis_isSpam_idx').using('btree', table.isSpam.asc().nullsLast()),
//     uniqueIndex('EmailAIAnalysis_messageId_key').using('btree', table.messageId.asc().nullsLast()),
//     index('EmailAIAnalysis_needsResponse_idx').using(
//       'btree',
//       table.needsResponse.asc().nullsLast()
//     ),
//     index('EmailAIAnalysis_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailAIAnalysis_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'EmailAIAnalysis_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailCategory = pgTable(
//   'EmailCategory',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     examplePhrases: text().array(),
//     keywordPatterns: text().array(),
//     autoLabel: boolean().default(true).notNull(),
//     autoAssignTo: text(),
//   },
//   (table) => [
//     uniqueIndex('EmailCategory_organizationId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'EmailCategory_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const messageParticipant = pgTable(
//   'MessageParticipant',
//   {
//     id: text().primaryKey().notNull(),
//     role: participantRole().notNull(),
//     messageId: text().notNull(),
//     participantId: text().notNull(),
//     contactId: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('MessageParticipant_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     uniqueIndex('MessageParticipant_messageId_participantId_role_key').using(
//       'btree',
//       table.messageId.asc().nullsLast(),
//       table.participantId.asc().nullsLast(),
//       table.role.asc().nullsLast()
//     ),
//     index('MessageParticipant_participantId_idx').using(
//       'btree',
//       table.participantId.asc().nullsLast()
//     ),
//     index('MessageParticipant_role_idx').using('btree', table.role.asc().nullsLast()),
//     index('contact_history_idx').using(
//       'btree',
//       table.contactId.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     index('participant_lookup_idx').using(
//       'btree',
//       table.messageId.asc().nullsLast(),
//       table.contactId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'MessageParticipant_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.participantId],
//       foreignColumns: [participant.id],
//       name: 'MessageParticipant_participantId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const order = pgTable(
//   'Order',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     cancelledAt: timestamp({ precision: 3, mode: 'string' }),
//     closedAt: timestamp({ precision: 3, mode: 'string' }),
//     processedAt: timestamp({ precision: 3, mode: 'string' }),
//     cancelReason: orderCancelReason(),
//     canNotifyCustomer: boolean().default(false).notNull(),
//     confirmationNumber: text(),
//     currencyCode: text().default('USD').notNull(),
//     discountCode: text(),
//     financialStatus: orderFinancialStatus().notNull(),
//     fulfillmentStatus: orderFulfillmentStatus().notNull(),
//     email: text(),
//     name: text().notNull(),
//     note: text(),
//     phone: text(),
//     poNumber: text(),
//     returnStatus: orderReturnStatus(),
//     tags: text().array(),
//     taxExempt: boolean().default(false).notNull(),
//     subtotalPrice: integer().default(0).notNull(),
//     totalDiscounts: integer().default(0).notNull(),
//     totalPrice: integer().default(0).notNull(),
//     totalRefunded: integer().default(0).notNull(),
//     totalShippingPrice: integer().default(0).notNull(),
//     totalTax: integer().default(0).notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     shippingAddressId: bigint({ mode: 'number' }),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     billingAddressId: bigint({ mode: 'number' }),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     customerId: bigint({ mode: 'number' }).notNull(),
//     organizationId: text().notNull(),
//     integrationId: text().notNull(),
//   },
//   (table) => [
//     index('Order_customerId_idx').using('btree', table.customerId.asc().nullsLast()),
//     index('Order_name_idx').using('btree', table.name.asc().nullsLast()),
//     foreignKey({
//       columns: [table.billingAddressId],
//       foreignColumns: [address.id],
//       name: 'Order_billingAddressId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.customerId],
//       foreignColumns: [shopifyCustomers.id],
//       name: 'Order_customerId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [shopifyIntegration.id],
//       name: 'Order_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Order_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.shippingAddressId],
//       foreignColumns: [address.id],
//       name: 'Order_shippingAddressId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const thread = pgTable(
//   'Thread',
//   {
//     id: text().primaryKey().notNull(),
//     externalId: text(),
//     subject: text().notNull(),
//     participantIds: text().array(),
//     organizationId: text().notNull(),
//     integrationId: text().notNull(),
//     integrationType: integrationType().notNull(),
//     assigneeId: text(),
//     messageType: messageType().notNull(),
//     type: threadType().default('EMAIL').notNull(),
//     status: threadStatus().default('OPEN').notNull(),
//     messageCount: integer().default(0).notNull(),
//     participantCount: integer().default(0).notNull(),
//     firstMessageAt: timestamp({ precision: 3, mode: 'string' }),
//     lastMessageAt: timestamp({ precision: 3, mode: 'string' }),
//     closedAt: timestamp({ precision: 3, mode: 'string' }),
//     repliedAt: timestamp({ precision: 3, mode: 'string' }),
//     waitingSince: timestamp({ precision: 3, mode: 'string' }),
//     inboxId: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('Thread_inboxId_idx').using('btree', table.inboxId.asc().nullsLast()),
//     uniqueIndex('Thread_integrationId_externalId_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast(),
//       table.externalId.asc().nullsLast()
//     ),
//     index('Thread_integrationId_idx').using('btree', table.integrationId.asc().nullsLast()),
//     index('Thread_lastMessageAt_idx').using('btree', table.lastMessageAt.asc().nullsLast()),
//     index('Thread_organizationId_assigneeId_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.assigneeId.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     index('Thread_organizationId_createdAt_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     index('Thread_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Thread_organizationId_messageType_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.messageType.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     index('Thread_organizationId_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     index('Thread_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('thread_pagination_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.lastMessageAt.desc().nullsFirst(),
//       table.id.desc().nullsFirst()
//     ),
//     index('thread_participants_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.participantIds.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.assigneeId],
//       foreignColumns: [user.id],
//       name: 'Thread_assigneeId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.inboxId],
//       foreignColumns: [inbox.id],
//       name: 'Thread_inboxId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [integration.id],
//       name: 'Thread_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Thread_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const product = pgTable(
//   'Product',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     publishedAt: timestamp({ precision: 3, mode: 'string' }),
//     title: text().notNull(),
//     descriptionHtml: text(),
//     vendor: text(),
//     hasOnlyDefaultVariant: boolean().notNull(),
//     productType: text(),
//     handle: text().notNull(),
//     status: produdtStatus().default('DRAFT').notNull(),
//     tags: text().array(),
//     tracksInventory: boolean().notNull(),
//     totalInventory: integer().notNull(),
//     integrationId: text().notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('Product_handle_key').using('btree', table.handle.asc().nullsLast()),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [shopifyIntegration.id],
//       name: 'Product_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Product_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailKbArticleReference = pgTable(
//   'EmailKBArticleReference',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     articleId: text().notNull(),
//     isRecommended: boolean().default(false).notNull(),
//   },
//   (table) => [
//     uniqueIndex('EmailKBArticleReference_messageId_articleId_key').using(
//       'btree',
//       table.messageId.asc().nullsLast(),
//       table.articleId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.articleId],
//       foreignColumns: [article.id],
//       name: 'EmailKBArticleReference_articleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailKBArticleReference_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const article = pgTable(
//   'Article',
//   {
//     id: text().primaryKey().notNull(),
//     title: varchar({ length: 255 }).notNull(),
//     description: text(),
//     emoji: text(),
//     slug: text().notNull(),
//     content: text().notNull(),
//     contentJson: jsonb(),
//     excerpt: text(),
//     isCategory: boolean().default(false).notNull(),
//     authorId: text(),
//     status: articleStatus().default('DRAFT').notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     lastReviewedAt: timestamp({ precision: 3, mode: 'string' }),
//     viewsCount: integer().default(0).notNull(),
//     knowledgeBaseId: text().notNull(),
//     organizationId: text().notNull(),
//     parentId: text(),
//     order: integer().default(0).notNull(),
//     isPublished: boolean().default(false).notNull(),
//     publishedAt: timestamp({ precision: 3, mode: 'string' }),
//     isHomePage: boolean().default(false).notNull(),
//     embedding: vector({ dimensions: 1536 }),
//   },
//   (table) => [
//     index('Article_isCategory_idx').using('btree', table.isCategory.asc().nullsLast()),
//     index('Article_knowledgeBaseId_idx').using('btree', table.knowledgeBaseId.asc().nullsLast()),
//     uniqueIndex('Article_knowledgeBaseId_slug_key').using(
//       'btree',
//       table.knowledgeBaseId.asc().nullsLast(),
//       table.slug.asc().nullsLast()
//     ),
//     index('Article_parentId_idx').using('btree', table.parentId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.authorId],
//       foreignColumns: [user.id],
//       name: 'Article_authorId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.knowledgeBaseId],
//       foreignColumns: [knowledgeBase.id],
//       name: 'Article_knowledgeBaseId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Article_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentId],
//       foreignColumns: [table.id],
//       name: 'Article_parentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const integration = pgTable(
//   'Integration',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text(),
//     refreshToken: text(),
//     accessToken: text(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }),
//     enabled: boolean().default(true).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     metadata: jsonb(),
//     routingEnabled: boolean().default(false).notNull(),
//     routingId: text(),
//     routingDomain: text(),
//     destinationEmail: text(),
//     lastSyncedAt: timestamp({ precision: 3, mode: 'string' }),
//     refreshTokenExpiresIn: integer(),
//     email: text(),
//     customerId: text(),
//     lastHistoryId: text(),
//     settings: jsonb().default({}).notNull(),
//     messageType: messageType().default('EMAIL').notNull(),
//     authStatus: integrationAuthStatus().default('AUTHENTICATED').notNull(),
//     lastAuthError: text(),
//     lastAuthErrorAt: timestamp({ precision: 3, mode: 'string' }),
//     lastSuccessfulSync: timestamp({ precision: 3, mode: 'string' }),
//     requiresReauth: boolean().default(false).notNull(),
//     provider: integrationProviderType().default('google').notNull(),
//   },
//   (table) => [
//     uniqueIndex('Integration_organizationId_email_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.email.asc().nullsLast()
//     ),
//     index('Integration_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Integration_provider_organizationId_idx').using(
//       'btree',
//       table.provider.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Integration_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const aiUsage = pgTable(
//   'AiUsage',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     provider: text().notNull(),
//     model: text().notNull(),
//     totalTokens: integer().default(0).notNull(),
//     cost: doublePrecision(),
//     organizationId: text().notNull(),
//     userId: text(),
//     endpoint: text(),
//     inputTokens: integer().default(0).notNull(),
//     modelType: text().default('llm').notNull(),
//     outputTokens: integer().default(0).notNull(),
//     requestId: text(),
//     responseTime: integer(),
//   },
//   (table) => [
//     index('AiUsage_createdAt_idx').using('btree', table.createdAt.asc().nullsLast()),
//     index('AiUsage_organizationId_createdAt_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     index('AiUsage_provider_model_idx').using(
//       'btree',
//       table.provider.asc().nullsLast(),
//       table.model.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'AiUsage_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'AiUsage_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const aiIntegration = pgTable(
//   'AiIntegration',
//   {
//     id: text().primaryKey().notNull(),
//     provider: text().notNull(),
//     model: text().notNull(),
//     apiKey: text().notNull(),
//     organizationId: text().notNull(),
//     userId: text().notNull(),
//     isDefault: boolean().default(false).notNull(),
//     status: aiIntegrationStatus().default('PENDING').notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     encryptedCredentials: jsonb(),
//     loadBalancingEnabled: boolean().default(false).notNull(),
//     modelType: text().default('llm').notNull(),
//     providerType: text().default('custom').notNull(),
//     quotaLimit: integer()
//       .default(sql`'-1'`)
//       .notNull(),
//     quotaType: text(),
//     quotaUsed: integer().default(0).notNull(),
//   },
//   (table) => [
//     index('AiIntegration_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('AiIntegration_organizationId_isDefault_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.isDefault.asc().nullsLast()
//     ),
//     index('AiIntegration_organizationId_modelType_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.modelType.asc().nullsLast()
//     ),
//     index('AiIntegration_organizationId_providerType_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.providerType.asc().nullsLast()
//     ),
//     uniqueIndex('AiIntegration_provider_organizationId_key').using(
//       'btree',
//       table.provider.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'AiIntegration_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'AiIntegration_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const responseTemplate = pgTable(
//   'ResponseTemplate',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     subject: text(),
//     htmlContent: text().notNull(),
//     textContent: text().notNull(),
//     category: text(),
//     tags: text().array(),
//     isActive: boolean().default(true).notNull(),
//     applicableFor: jsonb(),
//     usageCount: integer().default(0).notNull(),
//     lastUsed: timestamp({ precision: 3, mode: 'string' }),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     createdById: text(),
//   },
//   (table) => [
//     index('ResponseTemplate_organizationId_isActive_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.isActive.asc().nullsLast()
//     ),
//     uniqueIndex('ResponseTemplate_organizationId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ResponseTemplate_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const autoResponseRule = pgTable(
//   'AutoResponseRule',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     isActive: boolean().default(true).notNull(),
//     priority: integer().default(10).notNull(),
//     conditions: jsonb().notNull(),
//     responseType: responseType().notNull(),
//     templateId: text(),
//     aiPrompt: text(),
//     requiresApproval: boolean().default(true).notNull(),
//     approverRoleIds: text().array(),
//     approverUserIds: text().array(),
//     delayMinutes: integer(),
//     sendDuringBusinessHours: boolean().default(true).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     executionCount: integer().default(0).notNull(),
//     successCount: integer().default(0).notNull(),
//   },
//   (table) => [
//     index('AutoResponseRule_organizationId_isActive_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.isActive.asc().nullsLast()
//     ),
//     uniqueIndex('AutoResponseRule_organizationId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     index('AutoResponseRule_priority_idx').using('btree', table.priority.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'AutoResponseRule_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailAttachment = pgTable(
//   'EmailAttachment',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     mimeType: text().notNull(),
//     size: integer().notNull(),
//     inline: boolean().notNull(),
//     contentId: text(),
//     content: text(),
//     contentLocation: text(),
//     messageId: text().notNull(),
//     attachmentOrder: integer().default(0).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     mediaAssetId: text(),
//   },
//   (table) => [
//     index('EmailAttachment_mediaAssetId_idx').using('btree', table.mediaAssetId.asc().nullsLast()),
//     index('EmailAttachment_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.mediaAssetId],
//       foreignColumns: [mediaAsset.id],
//       name: 'EmailAttachment_mediaAssetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailAttachment_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const executedRule = pgTable(
//   'ExecutedRule',
//   {
//     id: text().primaryKey().notNull(),
//     ruleId: text().notNull(),
//     messageId: text().notNull(),
//     threadId: text().notNull(),
//     executedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     successful: boolean().default(true).notNull(),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('ExecutedRule_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     index('ExecutedRule_ruleId_idx').using('btree', table.ruleId.asc().nullsLast()),
//     index('ExecutedRule_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'ExecutedRule_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'ExecutedRule_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'ExecutedRule_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const threadAnalysis = pgTable(
//   'ThreadAnalysis',
//   {
//     id: text().primaryKey().notNull(),
//     threadId: text().notNull(),
//     organizationId: text().notNull(),
//     messageCount: integer().default(0).notNull(),
//     participantCount: integer().default(0).notNull(),
//     firstMessageAt: timestamp({ precision: 3, mode: 'string' }),
//     lastMessageAt: timestamp({ precision: 3, mode: 'string' }),
//     internalMessages: integer().default(0).notNull(),
//     externalMessages: integer().default(0).notNull(),
//     unansweredCount: integer().default(0).notNull(),
//     averageResponseTime: integer(),
//     topCategories: text().array(),
//     status: threadStatus().default('ACTIVE').notNull(),
//     priority: integer().default(1).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('ThreadAnalysis_organizationId_priority_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.priority.asc().nullsLast()
//     ),
//     index('ThreadAnalysis_organizationId_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     uniqueIndex('ThreadAnalysis_threadId_key').using('btree', table.threadId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ThreadAnalysis_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'ThreadAnalysis_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const threadParticipant = pgTable(
//   'ThreadParticipant',
//   {
//     id: text().primaryKey().notNull(),
//     threadId: text().notNull(),
//     email: text().notNull(),
//     name: text(),
//     isInternal: boolean().default(false).notNull(),
//     messageCount: integer().default(1).notNull(),
//     firstMessageAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     lastMessageAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('ThreadParticipant_threadId_email_key').using(
//       'btree',
//       table.threadId.asc().nullsLast(),
//       table.email.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'ThreadParticipant_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const threadTracker = pgTable(
//   'ThreadTracker',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     sentAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     threadId: text().notNull(),
//     messageId: text().notNull(),
//     resolved: boolean().default(false).notNull(),
//     type: threadTrackerType().notNull(),
//     ruleId: text(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     index('ThreadTracker_organizationId_resolved_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.resolved.asc().nullsLast()
//     ),
//     index('ThreadTracker_organizationId_resolved_sentAt_type_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.resolved.asc().nullsLast(),
//       table.sentAt.asc().nullsLast(),
//       table.type.asc().nullsLast()
//     ),
//     uniqueIndex('ThreadTracker_organizationId_threadId_messageId_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.threadId.asc().nullsLast(),
//       table.messageId.asc().nullsLast()
//     ),
//     index('ThreadTracker_organizationId_type_resolved_sentAt_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.type.asc().nullsLast(),
//       table.resolved.asc().nullsLast(),
//       table.sentAt.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ThreadTracker_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'ThreadTracker_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const extractionTemplate = pgTable(
//   'ExtractionTemplate',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text().notNull(),
//     description: text(),
//     sampleText: text(),
//     sampleHtml: text(),
//     isActive: boolean().default(true).notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     index('ExtractionTemplate_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ExtractionTemplate_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const customExtractionRule = pgTable(
//   'CustomExtractionRule',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text().notNull(),
//     description: text(),
//     entityType: text().notNull(),
//     displayName: text().notNull(),
//     ruleType: extractionRuleType().notNull(),
//     pattern: text(),
//     examples: text().array(),
//     contextBefore: text(),
//     contextAfter: text(),
//     htmlContext: text(),
//     positionStart: integer(),
//     positionEnd: integer(),
//     selectionText: text(),
//     selectionHtml: text(),
//     domPath: text(),
//     templateId: text(),
//     isActive: boolean().default(true).notNull(),
//     confidence: doublePrecision().default(0.7).notNull(),
//     priority: integer().default(10).notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('CustomExtractionRule_organizationId_entityType_templateId_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.entityType.asc().nullsLast(),
//       table.templateId.asc().nullsLast()
//     ),
//     index('CustomExtractionRule_organizationId_isActive_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.isActive.asc().nullsLast()
//     ),
//     index('CustomExtractionRule_templateId_idx').using('btree', table.templateId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'CustomExtractionRule_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.templateId],
//       foreignColumns: [extractionTemplate.id],
//       name: 'CustomExtractionRule_templateId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const productVariant = pgTable(
//   'ProductVariant',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     availableForSale: boolean().notNull(),
//     barcode: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }),
//     displayName: text().notNull(),
//     position: integer().default(1).notNull(),
//     price: integer().default(0).notNull(),
//     compareAtPrice: integer(),
//     sku: text(),
//     taxable: boolean().default(true).notNull(),
//     title: text().notNull(),
//     selectedOptions: jsonb().array(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     imageId: bigint({ mode: 'number' }),
//     imageUrl: text(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     inventoryItemId: bigint({ mode: 'number' }),
//     inventoryManagement: text(),
//     inventoryPolicy: inventoryPolicy().default('CONTINUE').notNull(),
//     inventoryQuantity: integer(),
//     weightUnit: text(),
//     weight: integer(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     productId: bigint({ mode: 'number' }).notNull(),
//     organizationId: text().notNull(),
//     integrationId: text().notNull(),
//   },
//   (table) => [
//     index('ProductVariant_productId_idx').using('btree', table.productId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [shopifyIntegration.id],
//       name: 'ProductVariant_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ProductVariant_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.productId],
//       foreignColumns: [product.id],
//       name: 'ProductVariant_productId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const productMedia = pgTable(
//   'ProductMedia',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     alt: text(),
//     mediaContentType: mediaContentType().default('IMAGE').notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     previewId: bigint({ mode: 'number' }).notNull(),
//     previewAlt: text(),
//     previewHeight: integer(),
//     previewWidth: integer(),
//     previewUrl: text(),
//     width: integer(),
//     height: integer(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }),
//     variantIds: text().array(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     productId: bigint({ mode: 'number' }).notNull(),
//   },
//   (table) => [
//     index('ProductMedia_productId_idx').using('btree', table.productId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.productId],
//       foreignColumns: [product.id],
//       name: 'ProductMedia_productId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const productOption = pgTable(
//   'ProductOption',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     name: text().notNull(),
//     position: integer(),
//     values: text().array(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     productId: bigint({ mode: 'number' }).notNull(),
//   },
//   (table) => [
//     index('ProductOption_productId_idx').using('btree', table.productId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.productId],
//       foreignColumns: [product.id],
//       name: 'ProductOption_productId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const shopifyCustomers = pgTable(
//   'shopify_customers',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     firstName: text(),
//     lastName: text(),
//     email: text(),
//     phone: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     numberOfOrders: integer(),
//     state: text(),
//     amountSpent: integer(),
//     note: text(),
//     verifiedEmail: boolean(),
//     multipassIdentifier: text(),
//     taxExempt: boolean(),
//     tags: text().array(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     defaultAddressId: bigint({ mode: 'number' }),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     lastOrderId: bigint({ mode: 'number' }),
//     lastOrderName: text(),
//     organizationId: text().notNull(),
//     integrationId: text().notNull(),
//     contactId: text(),
//   },
//   (table) => [
//     index('shopify_customers_contactId_idx').using('btree', table.contactId.asc().nullsLast()),
//     uniqueIndex('shopify_customers_defaultAddressId_key').using(
//       'btree',
//       table.defaultAddressId.asc().nullsLast()
//     ),
//     index('shopify_customers_email_idx').using('btree', table.email.asc().nullsLast()),
//     uniqueIndex('shopify_customers_lastOrderId_key').using(
//       'btree',
//       table.lastOrderId.asc().nullsLast()
//     ),
//     index('shopify_customers_phone_idx').using('btree', table.phone.asc().nullsLast()),
//     foreignKey({
//       columns: [table.contactId],
//       foreignColumns: [contact.id],
//       name: 'shopify_customers_contactId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.defaultAddressId],
//       foreignColumns: [address.id],
//       name: 'shopify_customers_defaultAddressId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [shopifyIntegration.id],
//       name: 'shopify_customers_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.lastOrderId],
//       foreignColumns: [order.id],
//       name: 'shopify_customers_lastOrderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'shopify_customers_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const address = pgTable(
//   'Address',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     address1: text(),
//     address2: text(),
//     city: text(),
//     company: text(),
//     countryCode: text(),
//     firstName: text(),
//     lastName: text(),
//     latitude: doublePrecision(),
//     longitude: doublePrecision(),
//     name: text(),
//     phone: text(),
//     provinceCode: text(),
//     zip: text(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     customerId: bigint({ mode: 'number' }),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }),
//     orderType: orderAddressType(),
//     organizationId: text().notNull(),
//     integrationId: text().notNull(),
//   },
//   (table) => [
//     index('Address_customerId_idx').using('btree', table.customerId.asc().nullsLast()),
//     index('Address_orderId_idx').using('btree', table.orderId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.customerId],
//       foreignColumns: [shopifyCustomers.id],
//       name: 'Address_customerId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [shopifyIntegration.id],
//       name: 'Address_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Address_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const orderRefund = pgTable(
//   'OrderRefund',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     totalRefundedAmount: integer().notNull(),
//     currencyCode: text().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }).notNull(),
//   },
//   (table) => [
//     index('OrderRefund_orderId_idx').using('btree', table.orderId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.orderId],
//       foreignColumns: [order.id],
//       name: 'OrderRefund_orderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const orderReturn = pgTable(
//   'OrderReturn',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     status: returnStatus().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }).notNull(),
//   },
//   (table) => [
//     index('OrderReturn_orderId_idx').using('btree', table.orderId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.orderId],
//       foreignColumns: [order.id],
//       name: 'OrderReturn_orderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const orderLineItem = pgTable(
//   'OrderLineItem',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text().notNull(),
//     quantity: integer().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     productId: bigint({ mode: 'number' }),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     variantId: bigint({ mode: 'number' }),
//     title: text().notNull(),
//     originalTotal: integer().default(0).notNull(),
//     originalUnitPrice: integer().default(0).notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }).notNull(),
//   },
//   (table) => [
//     index('OrderLineItem_orderId_idx').using('btree', table.orderId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.orderId],
//       foreignColumns: [order.id],
//       name: 'OrderLineItem_orderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const orderFulfillment = pgTable(
//   'OrderFulfillment',
//   {
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     id: bigint({ mode: 'number' }).primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     deliveredAt: timestamp({ precision: 3, mode: 'string' }),
//     status: fulfillmentStatus().default('OPEN').notNull(),
//     requiresShipping: boolean().default(true).notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }).notNull(),
//   },
//   (table) => [
//     index('OrderFulfillment_orderId_idx').using('btree', table.orderId.asc().nullsLast()),
//     index('OrderFulfillment_status_idx').using('btree', table.status.asc().nullsLast()),
//     foreignKey({
//       columns: [table.orderId],
//       foreignColumns: [order.id],
//       name: 'OrderFulfillment_orderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const fulfillmentTracking = pgTable(
//   'FulfillmentTracking',
//   {
//     id: bigserial({ mode: 'bigint' }).primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     number: text().notNull(),
//     url: text(),
//     company: text().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }).notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     fulfillmentId: bigint({ mode: 'number' }).notNull(),
//   },
//   (table) => [
//     index('FulfillmentTracking_fulfillmentId_idx').using(
//       'btree',
//       table.fulfillmentId.asc().nullsLast()
//     ),
//     index('FulfillmentTracking_number_idx').using('btree', table.number.asc().nullsLast()),
//     uniqueIndex('FulfillmentTracking_number_key').using('btree', table.number.asc().nullsLast()),
//     index('FulfillmentTracking_orderId_idx').using('btree', table.orderId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.fulfillmentId],
//       foreignColumns: [orderFulfillment.id],
//       name: 'FulfillmentTracking_fulfillmentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.orderId],
//       foreignColumns: [order.id],
//       name: 'FulfillmentTracking_orderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const subscription = pgTable(
//   'Subscription',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     provider: text().notNull(),
//     providerId: text().notNull(),
//     topic: text().notNull(),
//     format: text().notNull(),
//     secret: text(),
//     active: boolean().default(true).notNull(),
//     organizationId: text().notNull(),
//     integrationId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('Subscription_provider_integrationId_topic_key').using(
//       'btree',
//       table.provider.asc().nullsLast(),
//       table.integrationId.asc().nullsLast(),
//       table.topic.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [shopifyIntegration.id],
//       name: 'Subscription_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Subscription_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const webhookEvent = pgTable(
//   'WebhookEvent',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     retryCount: integer().default(0).notNull(),
//     payload: text().notNull(),
//     headers: text(),
//     subscriptionId: text().notNull(),
//     integrationId: text().notNull(),
//     organizationId: text().notNull(),
//     topic: text().notNull(),
//     eventId: text().notNull(),
//     status: syncStatus().default('PENDING').notNull(),
//     startTime: timestamp({ precision: 3, mode: 'string' }),
//     endTime: timestamp({ precision: 3, mode: 'string' }),
//     error: text(),
//   },
//   (table) => [
//     index('WebhookEvent_integrationId_idx').using('btree', table.integrationId.asc().nullsLast()),
//     index('WebhookEvent_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [shopifyIntegration.id],
//       name: 'WebhookEvent_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'WebhookEvent_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.subscriptionId],
//       foreignColumns: [subscription.id],
//       name: 'WebhookEvent_subscriptionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const event = pgTable(
//   'Event',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     type: text().notNull(),
//     data: jsonb().default({}).notNull(),
//   },
//   (table) => [
//     index('Event_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Event_type_idx').using('btree', table.type.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Event_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const webhook = pgTable(
//   'Webhook',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     url: text().notNull(),
//     secret: text().notNull(),
//     isActive: boolean().default(true).notNull(),
//     eventTypes: text().array(),
//     lastTriggeredAt: timestamp({ precision: 3, mode: 'string' }),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('Webhook_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Webhook_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const webhookDelivery = pgTable(
//   'WebhookDelivery',
//   {
//     id: text().primaryKey().notNull(),
//     webhookId: text().notNull(),
//     eventType: text().notNull(),
//     status: text().notNull(),
//     responseStatus: integer().notNull(),
//     responseBody: text(),
//     errorMessage: text(),
//     attemptCount: integer().default(1).notNull(),
//     nextRetryAt: timestamp({ precision: 3, mode: 'string' }),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('WebhookDelivery_webhookId_idx').using('btree', table.webhookId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.webhookId],
//       foreignColumns: [webhook.id],
//       name: 'WebhookDelivery_webhookId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const promptHistory = pgTable(
//   'PromptHistory',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     prompt: text().notNull(),
//     userId: text().notNull(),
//   },
//   (table) => [
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'PromptHistory_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const apiKey = pgTable(
//   'ApiKey',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text(),
//     hashedKey: text().notNull(),
//     isActive: boolean().default(true).notNull(),
//     userId: text().notNull(),
//     organizationId: text(),
//   },
//   (table) => [
//     uniqueIndex('ApiKey_hashedKey_key').using('btree', table.hashedKey.asc().nullsLast()),
//     index('ApiKey_userId_isActive_idx').using(
//       'btree',
//       table.userId.asc().nullsLast(),
//       table.isActive.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ApiKey_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'ApiKey_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const articleTag = pgTable(
//   'ArticleTag',
//   {
//     id: text().primaryKey().notNull(),
//     name: varchar({ length: 100 }).notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('ArticleTag_name_organizationId_key').using(
//       'btree',
//       table.name.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ArticleTag_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const articleRevision = pgTable(
//   'ArticleRevision',
//   {
//     id: text().primaryKey().notNull(),
//     articleId: text().notNull(),
//     editorId: text(),
//     organizationId: text().notNull(),
//     previousContent: text().notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     previousContentJson: jsonb(),
//     wasCategory: boolean().default(false).notNull(),
//   },
//   (table) => [
//     foreignKey({
//       columns: [table.articleId],
//       foreignColumns: [article.id],
//       name: 'ArticleRevision_articleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.editorId],
//       foreignColumns: [user.id],
//       name: 'ArticleRevision_editorId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ArticleRevision_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const part = pgTable(
//   'Part',
//   {
//     id: text().primaryKey().notNull(),
//     title: text().notNull(),
//     description: text(),
//     sku: text().notNull(),
//     hsCode: text(),
//     category: text(),
//     shopifyProductLinkId: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     cost: integer(),
//     createdById: text(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     uniqueIndex('Part_sku_key').using('btree', table.sku.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Part_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Part_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const subpart = pgTable(
//   'Subpart',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     parentPartId: text().notNull(),
//     childPartId: text().notNull(),
//     quantity: integer().notNull(),
//     notes: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('Subpart_parentPartId_childPartId_key').using(
//       'btree',
//       table.parentPartId.asc().nullsLast(),
//       table.childPartId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.childPartId],
//       foreignColumns: [part.id],
//       name: 'Subpart_childPartId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Subpart_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentPartId],
//       foreignColumns: [part.id],
//       name: 'Subpart_parentPartId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const vendor = pgTable(
//   'Vendor',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     contactName: text(),
//     email: text(),
//     phone: text(),
//     address: text(),
//     website: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Vendor_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const vendorPart = pgTable(
//   'VendorPart',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     partId: text().notNull(),
//     vendorId: text().notNull(),
//     vendorSku: text().notNull(),
//     unitPrice: integer(),
//     leadTime: integer(),
//     minOrderQty: integer(),
//     isPreferred: boolean().default(false).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('VendorPart_partId_vendorId_key').using(
//       'btree',
//       table.partId.asc().nullsLast(),
//       table.vendorId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'VendorPart_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.partId],
//       foreignColumns: [part.id],
//       name: 'VendorPart_partId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.vendorId],
//       foreignColumns: [vendor.id],
//       name: 'VendorPart_vendorId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const inventory = pgTable(
//   'Inventory',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     partId: text().notNull(),
//     quantity: integer().default(0).notNull(),
//     location: text(),
//     reorderPoint: integer(),
//     reorderQty: integer(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('Inventory_partId_key').using('btree', table.partId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Inventory_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.partId],
//       foreignColumns: [part.id],
//       name: 'Inventory_partId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ticketSequence = pgTable(
//   'TicketSequence',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     currentNumber: integer().default(0).notNull(),
//     prefix: text(),
//     paddingLength: integer().default(4).notNull(),
//     usePrefix: boolean().default(true).notNull(),
//     useDateInPrefix: boolean().default(false).notNull(),
//     dateFormat: text().default('YYMM'),
//     separator: text().default('-').notNull(),
//     suffix: text(),
//     useSuffix: boolean().default(false).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('TicketSequence_organizationId_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'TicketSequence_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ticketReply = pgTable(
//   'TicketReply',
//   {
//     id: text().primaryKey().notNull(),
//     content: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     messageId: text(),
//     senderEmail: text(),
//     isFromCustomer: boolean().default(false).notNull(),
//     ticketId: text().notNull(),
//     recipientEmail: text(),
//     ccEmails: text().array().default(['RAY']),
//     createdById: text(),
//     mailgunMessageId: text(),
//     inReplyTo: text(),
//     references: text(),
//   },
//   (table) => [
//     uniqueIndex('TicketReply_mailgunMessageId_key').using(
//       'btree',
//       table.mailgunMessageId.asc().nullsLast()
//     ),
//     index('TicketReply_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     uniqueIndex('TicketReply_messageId_key').using('btree', table.messageId.asc().nullsLast()),
//     index('TicketReply_ticketId_idx').using('btree', table.ticketId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'TicketReply_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.ticketId],
//       foreignColumns: [ticket.id],
//       name: 'TicketReply_ticketId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ticketRelation = pgTable(
//   'TicketRelation',
//   {
//     id: text().primaryKey().notNull(),
//     ticketId: text().notNull(),
//     relatedTicketId: text().notNull(),
//     relation: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     uniqueIndex('TicketRelation_ticketId_relatedTicketId_key').using(
//       'btree',
//       table.ticketId.asc().nullsLast(),
//       table.relatedTicketId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.relatedTicketId],
//       foreignColumns: [ticket.id],
//       name: 'TicketRelation_relatedTicketId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ticketId],
//       foreignColumns: [ticket.id],
//       name: 'TicketRelation_ticketId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ticket = pgTable(
//   'Ticket',
//   {
//     id: text().primaryKey().notNull(),
//     number: text().notNull(),
//     title: text().notNull(),
//     description: text(),
//     type: ticketType().notNull(),
//     priority: ticketPriority().default('MEDIUM').notNull(),
//     status: ticketStatus().default('OPEN').notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     dueDate: timestamp({ precision: 3, mode: 'string' }),
//     resolvedAt: timestamp({ precision: 3, mode: 'string' }),
//     closedAt: timestamp({ precision: 3, mode: 'string' }),
//     organizationId: text().notNull(),
//     emailThreadId: text(),
//     createdById: text(),
//     parentTicketId: text(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }),
//     mailgunMessageId: text(),
//     internalReference: text(),
//     contactId: text().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     shopifyCustomerId: bigint({ mode: 'number' }),
//     typeData: jsonb().default({}),
//     typeStatus: text(),
//   },
//   (table) => [
//     index('Ticket_contactId_idx').using('btree', table.contactId.asc().nullsLast()),
//     index('Ticket_emailThreadId_idx').using('btree', table.emailThreadId.asc().nullsLast()),
//     uniqueIndex('Ticket_mailgunMessageId_key').using(
//       'btree',
//       table.mailgunMessageId.asc().nullsLast()
//     ),
//     index('Ticket_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Ticket_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('Ticket_type_idx').using('btree', table.type.asc().nullsLast()),
//     foreignKey({
//       columns: [table.contactId],
//       foreignColumns: [contact.id],
//       name: 'Ticket_contactId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Ticket_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.orderId],
//       foreignColumns: [order.id],
//       name: 'Ticket_orderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Ticket_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentTicketId],
//       foreignColumns: [table.id],
//       name: 'Ticket_parentTicketId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.shopifyCustomerId],
//       foreignColumns: [shopifyCustomers.id],
//       name: 'Ticket_shopifyCustomerId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const knowledgeBase = pgTable(
//   'KnowledgeBase',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     slug: text().notNull(),
//     description: text(),
//     isPublic: boolean().default(false).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//     customDomain: text(),
//     logoDark: text(),
//     logoLight: text(),
//     theme: text().default('clean'),
//     showMode: boolean().default(true).notNull(),
//     defaultMode: text().default('light'),
//     primaryColorLight: text(),
//     primaryColorDark: text(),
//     tintColorLight: text(),
//     tintColorDark: text(),
//     infoColorLight: text(),
//     infoColorDark: text(),
//     successColorLight: text(),
//     successColorDark: text(),
//     warningColorLight: text(),
//     warningColorDark: text(),
//     dangerColorLight: text(),
//     dangerColorDark: text(),
//     fontFamily: text(),
//     iconsFamily: text().default('Regular'),
//     cornerStyle: text().default('Rounded'),
//     sidebarListStyle: text().default('Default'),
//     searchbarPosition: text().default('center'),
//     headerNavigation: jsonb(),
//     footerNavigation: jsonb(),
//     logoDarkId: text(),
//     logoLightId: text(),
//   },
//   (table) => [
//     uniqueIndex('KnowledgeBase_logoDarkId_key').using('btree', table.logoDarkId.asc().nullsLast()),
//     uniqueIndex('KnowledgeBase_logoLightId_key').using(
//       'btree',
//       table.logoLightId.asc().nullsLast()
//     ),
//     index('KnowledgeBase_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('KnowledgeBase_organizationId_slug_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.slug.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.logoDarkId],
//       foreignColumns: [mediaAsset.id],
//       name: 'KnowledgeBase_logoDarkId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.logoLightId],
//       foreignColumns: [mediaAsset.id],
//       name: 'KnowledgeBase_logoLightId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'KnowledgeBase_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ticketNote = pgTable(
//   'TicketNote',
//   {
//     id: text().primaryKey().notNull(),
//     ticketId: text().notNull(),
//     content: text().notNull(),
//     authorId: text(),
//     isInternal: boolean().default(true).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('TicketNote_authorId_idx').using('btree', table.authorId.asc().nullsLast()),
//     index('TicketNote_ticketId_idx').using('btree', table.ticketId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.authorId],
//       foreignColumns: [user.id],
//       name: 'TicketNote_authorId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.ticketId],
//       foreignColumns: [ticket.id],
//       name: 'TicketNote_ticketId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ticketAssignment = pgTable(
//   'TicketAssignment',
//   {
//     id: text().primaryKey().notNull(),
//     ticketId: text().notNull(),
//     agentId: text().notNull(),
//     isActive: boolean().default(true).notNull(),
//     assignedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('TicketAssignment_ticketId_agentId_isActive_key').using(
//       'btree',
//       table.ticketId.asc().nullsLast(),
//       table.agentId.asc().nullsLast(),
//       table.isActive.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.agentId],
//       foreignColumns: [user.id],
//       name: 'TicketAssignment_agentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ticketId],
//       foreignColumns: [ticket.id],
//       name: 'TicketAssignment_ticketId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const user = pgTable(
//   'User',
//   {
//     id: text().primaryKey().notNull(),
//     name: text(),
//     email: text(),
//     lastActiveAt: timestamp({ precision: 3, mode: 'string' }),
//     completedOnboarding: boolean().default(false),
//     twoFactorEnabled: boolean().default(false),
//     hashedPassword: text(),
//     watchEmailsExpirationDate: timestamp({ precision: 3, mode: 'string' }),
//     image: text(),
//     about: text(),
//     isSuperAdmin: boolean().default(false).notNull(),
//     defaultOrganizationId: text(),
//     settings: jsonb().default({}).notNull(),
//     webhookSecret: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     phoneNumber: text(),
//     phoneNumberVerified: boolean().default(false),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     emailVerified: boolean().default(false).notNull(),
//     avatarAssetId: text(),
//     userType: userType().default('USER').notNull(),
//     firstName: text(),
//     lastName: text(),
//   },
//   (table) => [
//     uniqueIndex('User_avatarAssetId_key').using('btree', table.avatarAssetId.asc().nullsLast()),
//     uniqueIndex('User_email_key').using('btree', table.email.asc().nullsLast()),
//     foreignKey({
//       columns: [table.avatarAssetId],
//       foreignColumns: [mediaAsset.id],
//       name: 'User_avatarAssetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const mailDomain = pgTable(
//   'MailDomain',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     domain: text().notNull(),
//     subdomain: text(),
//     type: domainType().default('CUSTOM').notNull(),
//     routingPrefix: text().default('ticket').notNull(),
//     isVerified: boolean().default(false).notNull(),
//     verificationToken: text().notNull(),
//     verifiedAt: timestamp({ precision: 3, mode: 'string' }),
//     isActive: boolean().default(true).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     webhookKey: text(),
//   },
//   (table) => [
//     uniqueIndex('MailDomain_organizationId_domain_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.domain.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'MailDomain_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailTemplate = pgTable(
//   'EmailTemplate',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     type: emailTemplateType().notNull(),
//     subject: text().notNull(),
//     bodyHtml: text().notNull(),
//     bodyPlain: text(),
//     variables: jsonb().default({}).notNull(),
//     isDefault: boolean().default(false).notNull(),
//     isActive: boolean().default(true).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('EmailTemplate_organizationId_type_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.type.asc().nullsLast()
//     ),
//     uniqueIndex('EmailTemplate_organizationId_type_isDefault_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.type.asc().nullsLast(),
//       table.isDefault.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'EmailTemplate_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const snippetFolder = pgTable(
//   'SnippetFolder',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     description: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     parentId: text(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//   },
//   (table) => [
//     index('SnippetFolder_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('SnippetFolder_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('SnippetFolder_organizationId_parentId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.parentId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'SnippetFolder_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'SnippetFolder_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentId],
//       foreignColumns: [table.id],
//       name: 'SnippetFolder_parentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const snippet = pgTable(
//   'Snippet',
//   {
//     id: text().primaryKey().notNull(),
//     title: text().notNull(),
//     content: text().notNull(),
//     contentHtml: text(),
//     description: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     isDeleted: boolean().default(false).notNull(),
//     folderId: text(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//     sharingType: snippetSharingType().default('PRIVATE').notNull(),
//     isFavorite: boolean().default(false).notNull(),
//     usageCount: integer().default(0).notNull(),
//   },
//   (table) => [
//     index('Snippet_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('Snippet_folderId_idx').using('btree', table.folderId.asc().nullsLast()),
//     index('Snippet_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Snippet_sharingType_idx').using('btree', table.sharingType.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Snippet_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.folderId],
//       foreignColumns: [snippetFolder.id],
//       name: 'Snippet_folderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Snippet_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const snippetShare = pgTable(
//   'SnippetShare',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     snippetId: text().notNull(),
//     groupId: text(),
//     memberId: text(),
//     permission: snippetPermission().default('VIEW').notNull(),
//   },
//   (table) => [
//     index('SnippetShare_groupId_idx').using('btree', table.groupId.asc().nullsLast()),
//     index('SnippetShare_memberId_idx').using('btree', table.memberId.asc().nullsLast()),
//     uniqueIndex('SnippetShare_snippetId_groupId_memberId_key').using(
//       'btree',
//       table.snippetId.asc().nullsLast(),
//       table.groupId.asc().nullsLast(),
//       table.memberId.asc().nullsLast()
//     ),
//     index('SnippetShare_snippetId_idx').using('btree', table.snippetId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.groupId],
//       foreignColumns: [group.id],
//       name: 'SnippetShare_groupId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.memberId],
//       foreignColumns: [organizationMember.id],
//       name: 'SnippetShare_memberId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.snippetId],
//       foreignColumns: [snippet.id],
//       name: 'SnippetShare_snippetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const comment = pgTable(
//   'Comment',
//   {
//     id: text().primaryKey().notNull(),
//     content: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     deletedAt: timestamp({ precision: 3, mode: 'string' }),
//     threadId: text(),
//     ticketId: text(),
//     entityId: text().notNull(),
//     entityType: text().notNull(),
//     createdById: text().notNull(),
//     organizationId: text().notNull(),
//     parentId: text(),
//     isPinned: boolean().default(false).notNull(),
//     pinnedAt: timestamp({ precision: 3, mode: 'string' }),
//     pinnedById: text(),
//   },
//   (table) => [
//     index('Comment_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('Comment_deletedAt_idx').using('btree', table.deletedAt.asc().nullsLast()),
//     index('Comment_entityId_entityType_idx').using(
//       'btree',
//       table.entityId.asc().nullsLast(),
//       table.entityType.asc().nullsLast()
//     ),
//     index('Comment_isPinned_idx').using('btree', table.isPinned.asc().nullsLast()),
//     index('Comment_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Comment_parentId_idx').using('btree', table.parentId.asc().nullsLast()),
//     index('Comment_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
//     index('Comment_ticketId_idx').using('btree', table.ticketId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Comment_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Comment_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentId],
//       foreignColumns: [table.id],
//       name: 'Comment_parentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.pinnedById],
//       foreignColumns: [user.id],
//       name: 'Comment_pinnedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'Comment_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ticketId],
//       foreignColumns: [ticket.id],
//       name: 'Comment_ticketId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const commentMention = pgTable(
//   'CommentMention',
//   {
//     id: text().primaryKey().notNull(),
//     commentId: text().notNull(),
//     userId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('CommentMention_commentId_idx').using('btree', table.commentId.asc().nullsLast()),
//     uniqueIndex('CommentMention_commentId_userId_key').using(
//       'btree',
//       table.commentId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     index('CommentMention_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.commentId],
//       foreignColumns: [comment.id],
//       name: 'CommentMention_commentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'CommentMention_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const commentReaction = pgTable(
//   'CommentReaction',
//   {
//     id: text().primaryKey().notNull(),
//     commentId: text().notNull(),
//     userId: text().notNull(),
//     type: text().notNull(),
//     emoji: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('CommentReaction_commentId_idx').using('btree', table.commentId.asc().nullsLast()),
//     uniqueIndex('CommentReaction_commentId_userId_type_emoji_key').using(
//       'btree',
//       table.commentId.asc().nullsLast(),
//       table.userId.asc().nullsLast(),
//       table.type.asc().nullsLast(),
//       table.emoji.asc().nullsLast()
//     ),
//     index('CommentReaction_type_idx').using('btree', table.type.asc().nullsLast()),
//     index('CommentReaction_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.commentId],
//       foreignColumns: [comment.id],
//       name: 'CommentReaction_commentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'CommentReaction_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const signatureIntegrationShare = pgTable(
//   'SignatureIntegrationShare',
//   {
//     id: text().primaryKey().notNull(),
//     signatureId: text().notNull(),
//     integrationId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('SignatureIntegrationShare_integrationId_idx').using(
//       'btree',
//       table.integrationId.asc().nullsLast()
//     ),
//     index('SignatureIntegrationShare_signatureId_idx').using(
//       'btree',
//       table.signatureId.asc().nullsLast()
//     ),
//     uniqueIndex('SignatureIntegrationShare_signatureId_integrationId_key').using(
//       'btree',
//       table.signatureId.asc().nullsLast(),
//       table.integrationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [integration.id],
//       name: 'SignatureIntegrationShare_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.signatureId],
//       foreignColumns: [signature.id],
//       name: 'SignatureIntegrationShare_signatureId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const mailView = pgTable(
//   'MailView',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     description: text(),
//     organizationId: text().notNull(),
//     userId: text().notNull(),
//     isDefault: boolean().default(false).notNull(),
//     isPinned: boolean().default(false).notNull(),
//     isShared: boolean().default(false).notNull(),
//     filters: jsonb().notNull(),
//     sortField: text(),
//     sortDirection: text().default('desc'),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('MailView_isDefault_idx').using('btree', table.isDefault.asc().nullsLast()),
//     uniqueIndex('MailView_name_userId_organizationId_key').using(
//       'btree',
//       table.name.asc().nullsLast(),
//       table.userId.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     index('MailView_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('MailView_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'MailView_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'MailView_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const chatWidget = pgTable(
//   'ChatWidget',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     integrationId: text(),
//     name: text().notNull(),
//     description: text(),
//     isActive: boolean().default(true).notNull(),
//     title: text().default('Chat Support').notNull(),
//     subtitle: text(),
//     primaryColor: text().default('#4F46E5').notNull(),
//     logoUrl: text(),
//     position: text().default('BOTTOM_RIGHT').notNull(),
//     welcomeMessage: text(),
//     autoOpen: boolean().default(false).notNull(),
//     mobileFullScreen: boolean().default(true).notNull(),
//     collectUserInfo: boolean().default(false).notNull(),
//     offlineMessage: text().default(
//       "We're currently offline. Please leave a message and we'll get back to you as soon as possible."
//     ),
//     organizationId: text().notNull(),
//     allowedDomains: text().array(),
//     useAi: boolean().default(false).notNull(),
//     aiModel: text(),
//     aiInstructions: text(),
//   },
//   (table) => [
//     uniqueIndex('ChatWidget_integrationId_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast()
//     ),
//     index('ChatWidget_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     uniqueIndex('ChatWidget_organizationId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.integrationId],
//       foreignColumns: [integration.id],
//       name: 'ChatWidget_integrationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ChatWidget_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const operatingHours = pgTable(
//   'OperatingHours',
//   {
//     id: text().primaryKey().notNull(),
//     widgetId: text().notNull(),
//     dayOfWeek: integer().notNull(),
//     startHour: integer().notNull(),
//     startMinute: integer().notNull(),
//     endHour: integer().notNull(),
//     endMinute: integer().notNull(),
//     timezone: text().default('UTC').notNull(),
//   },
//   (table) => [
//     uniqueIndex('OperatingHours_widgetId_dayOfWeek_key').using(
//       'btree',
//       table.widgetId.asc().nullsLast(),
//       table.dayOfWeek.asc().nullsLast()
//     ),
//     index('OperatingHours_widgetId_idx').using('btree', table.widgetId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.widgetId],
//       foreignColumns: [chatWidget.id],
//       name: 'OperatingHours_widgetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const chatSession = pgTable(
//   'ChatSession',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     widgetId: text().notNull(),
//     organizationId: text().notNull(),
//     threadId: text(),
//     status: text().default('ACTIVE').notNull(),
//     lastActivityAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     closedAt: timestamp({ precision: 3, mode: 'string' }),
//     closedById: text(),
//     visitorId: text().notNull(),
//     visitorName: text(),
//     visitorEmail: text(),
//     userAgent: text(),
//     ipAddress: text(),
//     referrer: text(),
//     url: text(),
//   },
//   (table) => [
//     index('ChatSession_lastActivityAt_idx').using('btree', table.lastActivityAt.asc().nullsLast()),
//     index('ChatSession_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('ChatSession_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('ChatSession_visitorId_idx').using('btree', table.visitorId.asc().nullsLast()),
//     index('ChatSession_widgetId_idx').using('btree', table.widgetId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.closedById],
//       foreignColumns: [user.id],
//       name: 'ChatSession_closedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ChatSession_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'ChatSession_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.widgetId],
//       foreignColumns: [chatWidget.id],
//       name: 'ChatSession_widgetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const chatMessage = pgTable(
//   'ChatMessage',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     content: text().notNull(),
//     sender: text().notNull(),
//     status: text().default('SENT').notNull(),
//     sessionId: text().notNull(),
//     agentId: text(),
//     threadId: text().notNull(),
//   },
//   (table) => [
//     index('ChatMessage_agentId_idx').using('btree', table.agentId.asc().nullsLast()),
//     index('ChatMessage_createdAt_idx').using('btree', table.createdAt.asc().nullsLast()),
//     index('ChatMessage_sessionId_idx').using('btree', table.sessionId.asc().nullsLast()),
//     index('ChatMessage_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.agentId],
//       foreignColumns: [user.id],
//       name: 'ChatMessage_agentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.sessionId],
//       foreignColumns: [chatSession.id],
//       name: 'ChatMessage_sessionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'ChatMessage_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const chatAttachment = pgTable(
//   'ChatAttachment',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     filename: text().notNull(),
//     contentType: text().notNull(),
//     size: integer().notNull(),
//     url: text().notNull(),
//     sessionId: text().notNull(),
//     messageId: text(),
//   },
//   (table) => [
//     index('ChatAttachment_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     index('ChatAttachment_sessionId_idx').using('btree', table.sessionId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [chatMessage.id],
//       name: 'ChatAttachment_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.sessionId],
//       foreignColumns: [chatSession.id],
//       name: 'ChatAttachment_sessionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const planSubscription = pgTable(
//   'PlanSubscription',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     planId: text().notNull(),
//     status: subscriptionStatus().default('ACTIVE').notNull(),
//     seats: integer().default(1).notNull(),
//     billingCycle: billingCycle().default('MONTHLY').notNull(),
//     startDate: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     endDate: timestamp({ precision: 3, mode: 'string' }),
//     canceledAt: timestamp({ precision: 3, mode: 'string' }),
//     stripeCustomerId: text(),
//     stripeSubscriptionId: text(),
//     currentPeriodStart: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
//     currentPeriodEnd: timestamp({ precision: 3, mode: 'string' }),
//     creditsBalance: integer().default(0).notNull(),
//     paymentMethodId: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     trialStart: timestamp({ precision: 3, mode: 'string' }),
//     trialEnd: timestamp({ precision: 3, mode: 'string' }),
//     hasTrialEnded: boolean().default(false).notNull(),
//     trialConversionStatus: trialConversionStatus(),
//     isEligibleForTrial: boolean().default(true).notNull(),
//     trialEligibilityReason: text(),
//   },
//   (table) => [
//     uniqueIndex('PlanSubscription_organizationId_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('PlanSubscription_stripeCustomerId_key').using(
//       'btree',
//       table.stripeCustomerId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'PlanSubscription_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.paymentMethodId],
//       foreignColumns: [paymentMethod.id],
//       name: 'PlanSubscription_paymentMethodId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.planId],
//       foreignColumns: [plan.id],
//       name: 'PlanSubscription_planId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const plan = pgTable('Plan', {
//   id: text().primaryKey().notNull(),
//   name: text().notNull(),
//   description: text(),
//   features: jsonb().default([]).notNull(),
//   monthlyPrice: integer().notNull(),
//   annualPrice: integer().notNull(),
//   isCustomPricing: boolean().default(false).notNull(),
//   createdAt: timestamp({ precision: 3, mode: 'string' })
//     .default(sql`CURRENT_TIMESTAMP`)
//     .notNull(),
//   updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   trialDays: integer().default(14).notNull(),
//   hasTrial: boolean().default(false).notNull(),
//   minSeats: integer().default(1).notNull(),
//   maxSeats: integer().default(10).notNull(),
//   isLegacy: boolean().default(false).notNull(),
//   selfServed: boolean().default(false).notNull(),
//   isMostPopular: boolean().default(false).notNull(),
//   isFree: boolean().default(false).notNull(),
//   featureLimits: jsonb().default([]),
//   stripeProductId: text(),
//   stripePriceIdMonthly: text(),
//   stripePriceIdAnnual: text(),
//   hierarchyLevel: integer().default(0).notNull(),
// })

// export const paymentMethod = pgTable(
//   'PaymentMethod',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     type: text().notNull(),
//     brand: text(),
//     last4: text(),
//     expMonth: integer(),
//     expYear: integer(),
//     isDefault: boolean().default(false).notNull(),
//     stripePaymentMethodId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('PaymentMethod_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'PaymentMethod_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const invoice = pgTable(
//   'Invoice',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     subscriptionId: text().notNull(),
//     invoiceNumber: text().notNull(),
//     amount: integer().notNull(),
//     status: invoiceStatus().default('PENDING').notNull(),
//     invoiceDate: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     dueDate: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     paidDate: timestamp({ precision: 3, mode: 'string' }),
//     currency: text(),
//     billingReason: text(),
//     stripeInvoiceId: text(),
//     pdfUrl: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('Invoice_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     uniqueIndex('Invoice_stripeInvoiceId_key').using(
//       'btree',
//       table.stripeInvoiceId.asc().nullsLast()
//     ),
//     index('Invoice_subscriptionId_idx').using('btree', table.subscriptionId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Invoice_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.subscriptionId],
//       foreignColumns: [planSubscription.id],
//       name: 'Invoice_subscriptionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const tag = pgTable(
//   'Tag',
//   {
//     id: text().primaryKey().notNull(),
//     title: text().notNull(),
//     description: text(),
//     emoji: text(),
//     color: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     parentId: text(),
//     organizationId: text().notNull(),
//     isSystemTag: boolean().default(false).notNull(),
//   },
//   (table) => [
//     index('Tag_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Tag_parentId_idx').using('btree', table.parentId.asc().nullsLast()),
//     uniqueIndex('Tag_title_organizationId_parentId_key').using(
//       'btree',
//       table.title.asc().nullsLast(),
//       table.organizationId.asc().nullsLast(),
//       table.parentId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Tag_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentId],
//       foreignColumns: [table.id],
//       name: 'Tag_parentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const notification = pgTable(
//   'Notification',
//   {
//     id: text().primaryKey().notNull(),
//     type: notificationType().notNull(),
//     message: text().notNull(),
//     isRead: boolean().default(false).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     readAt: timestamp({ precision: 3, mode: 'string' }),
//     userId: text().notNull(),
//     entityId: text().notNull(),
//     entityType: text().notNull(),
//     actorId: text(),
//     organizationId: text().notNull(),
//     deliveredAt: timestamp({ precision: 3, mode: 'string' }),
//     deliveryMethod: text(),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('Notification_entityType_entityId_idx').using(
//       'btree',
//       table.entityType.asc().nullsLast(),
//       table.entityId.asc().nullsLast()
//     ),
//     index('Notification_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Notification_userId_createdAt_idx').using(
//       'btree',
//       table.userId.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     index('Notification_userId_isRead_idx').using(
//       'btree',
//       table.userId.asc().nullsLast(),
//       table.isRead.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.actorId],
//       foreignColumns: [user.id],
//       name: 'Notification_actorId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Notification_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'Notification_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const verification = pgTable('verification', {
//   id: text().primaryKey().notNull(),
//   identifier: text().notNull(),
//   value: text().notNull(),
//   expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   createdAt: timestamp({ precision: 3, mode: 'string' })
//     .default(sql`CURRENT_TIMESTAMP`)
//     .notNull(),
//   updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
// })

// export const passkey = pgTable(
//   'Passkey',
//   {
//     id: text().primaryKey().notNull(),
//     name: text(),
//     publicKey: text().notNull(),
//     userId: text().notNull(),
//     credentialId: text().notNull(),
//     counter: integer().notNull(),
//     deviceType: text().notNull(),
//     backedUp: boolean().default(false).notNull(),
//     transports: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     aaguid: text(),
//   },
//   (table) => [
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'Passkey_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const account = pgTable(
//   'account',
//   {
//     id: text().primaryKey().notNull(),
//     userId: text().notNull(),
//     providerId: text().notNull(),
//     accountId: text().notNull(),
//     refreshToken: text(),
//     accessToken: text(),
//     accessTokenExpiresAt: timestamp({ precision: 3, mode: 'string' }),
//     refreshTokenExpiresAt: timestamp({ precision: 3, mode: 'string' }),
//     tokenType: text('token_type'),
//     scope: text(),
//     idToken: text(),
//     sessionState: text('session_state'),
//     lastHistoryId: text(),
//     password: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     uniqueIndex('account_providerId_accountId_key').using(
//       'btree',
//       table.providerId.asc().nullsLast(),
//       table.accountId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'account_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const session = pgTable(
//   'session',
//   {
//     id: text().primaryKey().notNull(),
//     token: text().notNull(),
//     userId: text().notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     ipAddress: text(),
//     userAgent: text(),
//   },
//   (table) => [
//     uniqueIndex('session_token_key').using('btree', table.token.asc().nullsLast()),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'session_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const twoFactor = pgTable(
//   'TwoFactor',
//   {
//     id: text().primaryKey().notNull(),
//     userId: text().notNull(),
//     secret: text(),
//     backupCodes: text(),
//   },
//   (table) => [
//     uniqueIndex('TwoFactor_userId_key').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'TwoFactor_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const syncJob = pgTable(
//   'SyncJob',
//   {
//     id: text().primaryKey().notNull(),
//     type: text().notNull(),
//     status: syncStatus().default('PENDING').notNull(),
//     startTime: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     endTime: timestamp({ precision: 3, mode: 'string' }),
//     error: text(),
//     totalRecords: integer().default(0).notNull(),
//     processedRecords: integer().default(0).notNull(),
//     organizationId: text().notNull(),
//     integrationId: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     failedRecords: integer().default(0).notNull(),
//     integrationCategory: text().default('message').notNull(),
//     integrationSyncJobIds: text().array().default(['RAY']),
//   },
//   (table) => [
//     index('SyncJob_organizationId_integrationCategory_integrationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.integrationCategory.asc().nullsLast(),
//       table.integrationId.asc().nullsLast()
//     ),
//     index('SyncJob_organizationId_integrationCategory_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.integrationCategory.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     index('SyncJob_organizationId_type_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.type.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'SyncJob_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const customField = pgTable(
//   'CustomField',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text().notNull(),
//     type: contactFieldType().notNull(),
//     description: text(),
//     required: boolean().default(false).notNull(),
//     active: boolean().default(true).notNull(),
//     position: integer().default(0).notNull(),
//     defaultValue: text(),
//     options: jsonb(),
//     organizationId: text().notNull(),
//     modelType: dataModelType().default('CONTACT').notNull(),
//     icon: text(),
//     isCustom: boolean().default(true).notNull(),
//   },
//   (table) => [
//     index('CustomField_modelType_idx').using('btree', table.modelType.asc().nullsLast()),
//     uniqueIndex('CustomField_name_organizationId_key').using(
//       'btree',
//       table.name.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     index('CustomField_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'CustomField_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const customFieldGroup = pgTable(
//   'CustomFieldGroup',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text().notNull(),
//     fields: text().array(),
//     organizationId: text().notNull(),
//     modelType: dataModelType().default('CONTACT').notNull(),
//   },
//   (table) => [
//     index('CustomFieldGroup_modelType_idx').using('btree', table.modelType.asc().nullsLast()),
//     uniqueIndex('CustomFieldGroup_name_organizationId_modelType_key').using(
//       'btree',
//       table.name.asc().nullsLast(),
//       table.organizationId.asc().nullsLast(),
//       table.modelType.asc().nullsLast()
//     ),
//     index('CustomFieldGroup_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'CustomFieldGroup_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const customFieldValue = pgTable(
//   'CustomFieldValue',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     entityId: text().notNull(),
//     fieldId: text().notNull(),
//     value: jsonb().default({}).notNull(),
//   },
//   (table) => [
//     uniqueIndex('CustomFieldValue_entityId_fieldId_key').using(
//       'btree',
//       table.entityId.asc().nullsLast(),
//       table.fieldId.asc().nullsLast()
//     ),
//     index('CustomFieldValue_entityId_idx').using('btree', table.entityId.asc().nullsLast()),
//     index('CustomFieldValue_fieldId_idx').using('btree', table.fieldId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.fieldId],
//       foreignColumns: [customField.id],
//       name: 'CustomFieldValue_fieldId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const tableView = pgTable(
//   'TableView',
//   {
//     id: text().primaryKey().notNull(),
//     tableId: text().notNull(),
//     name: text().notNull(),
//     config: jsonb().notNull(),
//     isDefault: boolean().default(false).notNull(),
//     isShared: boolean().default(false).notNull(),
//     userId: text().notNull(),
//     organizationId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('TableView_tableId_organizationId_idx').using(
//       'btree',
//       table.tableId.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('TableView_tableId_organizationId_isDefault_key').using(
//       'btree',
//       table.tableId.asc().nullsLast(),
//       table.organizationId.asc().nullsLast(),
//       table.isDefault.asc().nullsLast()
//     ),
//     index('TableView_tableId_userId_idx').using(
//       'btree',
//       table.tableId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     uniqueIndex('TableView_tableId_userId_name_key').using(
//       'btree',
//       table.tableId.asc().nullsLast(),
//       table.userId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'TableView_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'TableView_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ruleGroup = pgTable(
//   'RuleGroup',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     actions: jsonb(),
//     createdById: text(),
//     description: text(),
//     enabled: boolean().default(true).notNull(),
//     metadata: jsonb(),
//     name: text().notNull(),
//     operator: ruleGroupOperator().default('AND').notNull(),
//     priority: integer().default(10).notNull(),
//     threshold: doublePrecision(),
//   },
//   (table) => [
//     index('RuleGroup_enabled_idx').using('btree', table.enabled.asc().nullsLast()),
//     index('RuleGroup_organizationId_enabled_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.enabled.asc().nullsLast()
//     ),
//     index('RuleGroup_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'RuleGroup_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'RuleGroup_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ruleGroupRule = pgTable(
//   'RuleGroupRule',
//   {
//     id: text().primaryKey().notNull(),
//     groupId: text().notNull(),
//     ruleId: text().notNull(),
//     order: integer().default(0).notNull(),
//     required: boolean().default(true).notNull(),
//     weight: doublePrecision().default(1).notNull(),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('RuleGroupRule_groupId_idx').using('btree', table.groupId.asc().nullsLast()),
//     uniqueIndex('RuleGroupRule_groupId_ruleId_key').using(
//       'btree',
//       table.groupId.asc().nullsLast(),
//       table.ruleId.asc().nullsLast()
//     ),
//     index('RuleGroupRule_ruleId_idx').using('btree', table.ruleId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.groupId],
//       foreignColumns: [ruleGroup.id],
//       name: 'RuleGroupRule_groupId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'RuleGroupRule_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ruleGroupRelation = pgTable(
//   'RuleGroupRelation',
//   {
//     id: text().primaryKey().notNull(),
//     parentId: text().notNull(),
//     childId: text().notNull(),
//     order: integer().default(0).notNull(),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('RuleGroupRelation_childId_idx').using('btree', table.childId.asc().nullsLast()),
//     uniqueIndex('RuleGroupRelation_parentId_childId_key').using(
//       'btree',
//       table.parentId.asc().nullsLast(),
//       table.childId.asc().nullsLast()
//     ),
//     index('RuleGroupRelation_parentId_idx').using('btree', table.parentId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.childId],
//       foreignColumns: [ruleGroup.id],
//       name: 'RuleGroupRelation_childId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentId],
//       foreignColumns: [ruleGroup.id],
//       name: 'RuleGroupRelation_parentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const executedRuleGroup = pgTable(
//   'ExecutedRuleGroup',
//   {
//     id: text().primaryKey().notNull(),
//     groupId: text().notNull(),
//     messageId: text().notNull(),
//     threadId: text().notNull(),
//     matched: boolean().notNull(),
//     score: doublePrecision(),
//     executionTime: integer().notNull(),
//     ruleResults: jsonb().notNull(),
//     metadata: jsonb(),
//     executedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('ExecutedRuleGroup_executedAt_idx').using('btree', table.executedAt.asc().nullsLast()),
//     index('ExecutedRuleGroup_groupId_idx').using('btree', table.groupId.asc().nullsLast()),
//     index('ExecutedRuleGroup_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.groupId],
//       foreignColumns: [ruleGroup.id],
//       name: 'ExecutedRuleGroup_groupId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'ExecutedRuleGroup_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'ExecutedRuleGroup_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const testCase = pgTable(
//   'TestCase',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     description: text(),
//     email: jsonb().notNull(),
//     expectedRules: jsonb().notNull(),
//     expectedActions: jsonb().notNull(),
//     tags: text().array(),
//     version: integer().default(1).notNull(),
//     status: testCaseStatus().default('ACTIVE').notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//   },
//   (table) => [
//     index('TestCase_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('TestCase_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('TestCase_status_idx').using('btree', table.status.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'TestCase_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'TestCase_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const testSuite = pgTable(
//   'TestSuite',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     description: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//   },
//   (table) => [
//     index('TestSuite_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'TestSuite_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'TestSuite_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const testCaseInSuite = pgTable(
//   'TestCaseInSuite',
//   {
//     id: text().primaryKey().notNull(),
//     suiteId: text().notNull(),
//     testCaseId: text().notNull(),
//     order: integer().default(0).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('TestCaseInSuite_suiteId_idx').using('btree', table.suiteId.asc().nullsLast()),
//     uniqueIndex('TestCaseInSuite_suiteId_testCaseId_key').using(
//       'btree',
//       table.suiteId.asc().nullsLast(),
//       table.testCaseId.asc().nullsLast()
//     ),
//     index('TestCaseInSuite_testCaseId_idx').using('btree', table.testCaseId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.suiteId],
//       foreignColumns: [testSuite.id],
//       name: 'TestCaseInSuite_suiteId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.testCaseId],
//       foreignColumns: [testCase.id],
//       name: 'TestCaseInSuite_testCaseId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ruleInSuite = pgTable(
//   'RuleInSuite',
//   {
//     id: text().primaryKey().notNull(),
//     suiteId: text().notNull(),
//     ruleId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('RuleInSuite_ruleId_idx').using('btree', table.ruleId.asc().nullsLast()),
//     index('RuleInSuite_suiteId_idx').using('btree', table.suiteId.asc().nullsLast()),
//     uniqueIndex('RuleInSuite_suiteId_ruleId_key').using(
//       'btree',
//       table.suiteId.asc().nullsLast(),
//       table.ruleId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'RuleInSuite_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.suiteId],
//       foreignColumns: [testSuite.id],
//       name: 'RuleInSuite_suiteId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const testRun = pgTable(
//   'TestRun',
//   {
//     id: text().primaryKey().notNull(),
//     suiteId: text(),
//     status: testRunStatus().default('PENDING').notNull(),
//     startedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     completedAt: timestamp({ precision: 3, mode: 'string' }),
//     results: jsonb().notNull(),
//     summary: jsonb().notNull(),
//     executedById: text().notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     index('TestRun_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('TestRun_startedAt_idx').using('btree', table.startedAt.asc().nullsLast()),
//     index('TestRun_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('TestRun_suiteId_idx').using('btree', table.suiteId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.executedById],
//       foreignColumns: [user.id],
//       name: 'TestRun_executedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'TestRun_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.suiteId],
//       foreignColumns: [testSuite.id],
//       name: 'TestRun_suiteId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const testResult = pgTable(
//   'TestResult',
//   {
//     id: text().primaryKey().notNull(),
//     runId: text().notNull(),
//     testCaseId: text().notNull(),
//     passed: boolean().notNull(),
//     actualRules: jsonb().notNull(),
//     actualActions: jsonb().notNull(),
//     errorMessage: text(),
//     executionTime: integer().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('TestResult_passed_idx').using('btree', table.passed.asc().nullsLast()),
//     index('TestResult_runId_idx').using('btree', table.runId.asc().nullsLast()),
//     index('TestResult_testCaseId_idx').using('btree', table.testCaseId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.runId],
//       foreignColumns: [testRun.id],
//       name: 'TestResult_runId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.testCaseId],
//       foreignColumns: [testCase.id],
//       name: 'TestResult_testCaseId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const ruleAction = pgTable(
//   'RuleAction',
//   {
//     id: text().primaryKey().notNull(),
//     ruleId: text().notNull(),
//     actionType: actionType().notNull(),
//     parameters: jsonb().notNull(),
//     order: integer().default(0).notNull(),
//   },
//   (table) => [
//     index('RuleAction_ruleId_idx').using('btree', table.ruleId.asc().nullsLast()),
//     index('RuleAction_ruleId_order_idx').using(
//       'btree',
//       table.ruleId.asc().nullsLast(),
//       table.order.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'RuleAction_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const rule = pgTable(
//   'Rule',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     type: ruleType().notNull(),
//     enabled: boolean().default(true).notNull(),
//     conditions: jsonb(),
//     actions: jsonb(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     priority: integer().default(10).notNull(),
//     instructions: text(),
//     categoryFilterType: text(),
//     matchCount: integer().default(0).notNull(),
//     lastMatchedAt: timestamp({ precision: 3, mode: 'string' }),
//     applyToInternal: boolean(),
//     categoryIds: text().array(),
//     ruleGroupId: text(),
//     // TODO: failed to parse database type 'SenderType"[]'
//     senderTypes: unknown('senderTypes').array(),
//     spamConfidenceThreshold: doublePrecision(),
//     staticRuleType: staticRuleType(),
//     requiresManualApproval: boolean().default(false).notNull(),
//     workflowNodeId: text(),
//   },
//   (table) => [
//     index('Rule_organizationId_enabled_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.enabled.asc().nullsLast()
//     ),
//     uniqueIndex('Rule_organizationId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     index('Rule_organizationId_staticRuleType_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.staticRuleType.asc().nullsLast()
//     ),
//     index('Rule_organizationId_type_enabled_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.type.asc().nullsLast(),
//       table.enabled.asc().nullsLast()
//     ),
//     index('Rule_organizationId_type_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.type.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Rule_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.ruleGroupId],
//       foreignColumns: [ruleGroup.id],
//       name: 'Rule_ruleGroupId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailContentAnalysis = pgTable(
//   'EmailContentAnalysis',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     summary: text(),
//     urgency: integer(),
//     topics: text().array(),
//     needsResponse: boolean().default(false).notNull(),
//     sentiment: text(),
//     metadata: jsonb(),
//     entities: jsonb(),
//     intent: text(),
//     analyzedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     automationConfidence: doublePrecision(),
//     complexityScore: text(),
//     customerLifetimeValue: doublePrecision(),
//     customerTier: text(),
//     frustrationLevel: doublePrecision(),
//     orderContext: jsonb(),
//     retentionRisk: boolean().default(false).notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     shopifyCustomerId: bigint({ mode: 'number' }),
//     shopifyEntities: jsonb(),
//     shopifyIntent: text(),
//   },
//   (table) => [
//     index('EmailContentAnalysis_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     uniqueIndex('EmailContentAnalysis_messageId_key').using(
//       'btree',
//       table.messageId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailContentAnalysis_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const proposedAction = pgTable(
//   'ProposedAction',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     messageId: text().notNull(),
//     ruleId: text().notNull(),
//     actionParams: jsonb().notNull(),
//     modifiedParams: jsonb(),
//     status: proposedActionStatus().default('PENDING').notNull(),
//     approvedById: text(),
//     rejectedById: text(),
//     approvedAt: timestamp({ precision: 3, mode: 'string' }),
//     executedAt: timestamp({ precision: 3, mode: 'string' }),
//     executionError: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     confidence: doublePrecision(),
//     executionMetadata: jsonb(),
//     executionResult: jsonb(),
//     explanation: text(),
//     actionType: actionType().notNull(),
//   },
//   (table) => [
//     index('ProposedAction_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     index('ProposedAction_organizationId_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     index('ProposedAction_ruleId_idx').using('btree', table.ruleId.asc().nullsLast()),
//     index('ProposedAction_status_createdAt_idx').using(
//       'btree',
//       table.status.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.approvedById],
//       foreignColumns: [user.id],
//       name: 'ProposedAction_approvedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'ProposedAction_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ProposedAction_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.rejectedById],
//       foreignColumns: [user.id],
//       name: 'ProposedAction_rejectedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'ProposedAction_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailProcessingJob = pgTable(
//   'EmailProcessingJob',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     status: jobStatus().default('PENDING').notNull(),
//     attempts: integer().default(0).notNull(),
//     lastAttempt: timestamp({ precision: 3, mode: 'string' }),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     completedAt: timestamp({ precision: 3, mode: 'string' }),
//     error: text(),
//     organizationId: text().notNull(),
//     isSpam: boolean(),
//     categoryIds: text().array(),
//     aiSummary: text(),
//     sentiment: text(),
//     matchedRuleCount: integer().default(0).notNull(),
//     executedActionCount: integer().default(0).notNull(),
//     isInternal: boolean(),
//     senderType: senderType(),
//     automationEligible: boolean().default(false).notNull(),
//     automationReason: text(),
//     customerTier: text(),
//     orderValue: doublePrecision(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     primaryOrderId: bigint({ mode: 'number' }),
//     riskFactors: text().array().default(['RAY']),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     shopifyCustomerId: bigint({ mode: 'number' }),
//     shopifyIntent: text(),
//     threadId: text(),
//   },
//   (table) => [
//     index('EmailProcessingJob_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     index('EmailProcessingJob_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('EmailProcessingJob_organizationId_messageId_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.messageId.asc().nullsLast()
//     ),
//     index('EmailProcessingJob_status_createdAt_idx').using(
//       'btree',
//       table.status.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailProcessingJob_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'EmailProcessingJob_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'EmailProcessingJob_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailOrderReference = pgTable(
//   'EmailOrderReference',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     orderNumber: text().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     orderId: bigint({ mode: 'number' }),
//     exchangeEligible: boolean().default(false).notNull(),
//     fulfillmentStatus: text(),
//     hasIssues: boolean().default(false).notNull(),
//     issueTypes: text().array().default(['RAY']),
//     orderStatus: text(),
//     recommendedAction: text(),
//     refundEligible: boolean().default(false).notNull(),
//     returnEligible: boolean().default(false).notNull(),
//     suggestedResponse: text(),
//   },
//   (table) => [
//     uniqueIndex('EmailOrderReference_messageId_orderNumber_key').using(
//       'btree',
//       table.messageId.asc().nullsLast(),
//       table.orderNumber.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailOrderReference_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.orderId],
//       foreignColumns: [order.id],
//       name: 'EmailOrderReference_orderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const emailProductReference = pgTable(
//   'EmailProductReference',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     productId: bigint({ mode: 'number' }).notNull(),
//     inventoryAvailable: boolean().default(true).notNull(),
//     issueCategory: text(),
//     mentionType: text(),
//     returnRate: doublePrecision(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     variantId: bigint({ mode: 'number' }),
//   },
//   (table) => [
//     uniqueIndex('EmailProductReference_messageId_productId_key').using(
//       'btree',
//       table.messageId.asc().nullsLast(),
//       table.productId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailProductReference_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.productId],
//       foreignColumns: [product.id],
//       name: 'EmailProductReference_productId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const emailResponse = pgTable(
//   'EmailResponse',
//   {
//     id: text().primaryKey().notNull(),
//     messageId: text().notNull(),
//     threadId: text().notNull(),
//     organizationId: text().notNull(),
//     subject: text(),
//     htmlContent: text(),
//     textContent: text(),
//     toAddresses: text().array(),
//     ccAddresses: text().array(),
//     bccAddresses: text().array(),
//     responseType: responseType().default('MANUAL').notNull(),
//     templateId: text(),
//     generatedBy: text(),
//     status: responseStatus().default('DRAFT').notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     sentAt: timestamp({ precision: 3, mode: 'string' }),
//     createdById: text(),
//     deliveryStatus: deliveryStatus(),
//     analysisId: text(),
//     attachmentIds: text().array(),
//     metadata: jsonb(),
//     customerReplied: boolean().default(false).notNull(),
//     customerTierUsed: text(),
//     escalatedAfter: boolean().default(false).notNull(),
//     includesOrderData: boolean().default(false).notNull(),
//     includesTrackingInfo: boolean().default(false).notNull(),
//     personalizationData: jsonb(),
//     satisfactionScore: doublePrecision(),
//     shopifyResponseType: text(),
//   },
//   (table) => [
//     index('EmailResponse_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
//     index('EmailResponse_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('EmailResponse_status_idx').using('btree', table.status.asc().nullsLast()),
//     foreignKey({
//       columns: [table.analysisId],
//       foreignColumns: [emailAiAnalysis.id],
//       name: 'EmailResponse_analysisId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.messageId],
//       foreignColumns: [message.id],
//       name: 'EmailResponse_messageId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'EmailResponse_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'EmailResponse_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const shopifyAutomationMetrics = pgTable(
//   'ShopifyAutomationMetrics',
//   {
//     id: text().primaryKey().notNull(),
//     date: date().notNull(),
//     totalShopifyEmails: integer().default(0).notNull(),
//     automatedResponses: integer().default(0).notNull(),
//     manualEscalations: integer().default(0).notNull(),
//     orderStatusQueries: integer().default(0).notNull(),
//     orderStatusAutomated: integer().default(0).notNull(),
//     returnRequests: integer().default(0).notNull(),
//     returnAutomated: integer().default(0).notNull(),
//     avgConfidenceScore: doublePrecision(),
//     customerReplyRate: doublePrecision(),
//     escalationRate: doublePrecision(),
//     avgResponseTime: integer(),
//     costSavingsEstimate: doublePrecision(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     index('ShopifyAutomationMetrics_date_idx').using('btree', table.date.asc().nullsLast()),
//     uniqueIndex('ShopifyAutomationMetrics_organizationId_date_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.date.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ShopifyAutomationMetrics_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const shopifyAutomationRule = pgTable(
//   'ShopifyAutomationRule',
//   {
//     id: text().primaryKey().notNull(),
//     intentTypes: text().array(),
//     customerTiers: text().array(),
//     minConfidence: doublePrecision(),
//     responseTemplate: text().notNull(),
//     includeOrderData: boolean().default(true).notNull(),
//     includeTracking: boolean().default(true).notNull(),
//     maxOrderAge: integer(),
//     maxRefundAmount: doublePrecision(),
//     successRate: doublePrecision(),
//     aiInstructions: text(),
//     allowAutomaticRefunds: boolean().default(false).notNull(),
//     autoReplyForCommonQueries: boolean().default(true).notNull(),
//     enableCustomerLookup: boolean().default(true).notNull(),
//     enableInventoryCheck: boolean().default(false).notNull(),
//     enableOrderLookup: boolean().default(true).notNull(),
//     escalateComplexIssues: boolean().default(true).notNull(),
//     maxAutoReplyAttempts: integer().default(3).notNull(),
//     requireManagerApproval: boolean().default(true).notNull(),
//     ruleId: text().notNull(),
//     useAdvancedAi: boolean().default(false).notNull(),
//   },
//   (table) => [
//     index('ShopifyAutomationRule_ruleId_idx').using('btree', table.ruleId.asc().nullsLast()),
//     uniqueIndex('ShopifyAutomationRule_ruleId_key').using('btree', table.ruleId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.ruleId],
//       foreignColumns: [rule.id],
//       name: 'ShopifyAutomationRule_ruleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const integrationTagLabel = pgTable(
//   'IntegrationTagLabel',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     tagId: text().notNull(),
//     labelId: text().notNull(),
//     integrationId: text().notNull(),
//     organizationId: text().notNull(),
//   },
//   (table) => [
//     index('IntegrationTagLabel_integrationId_idx').using(
//       'btree',
//       table.integrationId.asc().nullsLast()
//     ),
//     uniqueIndex('IntegrationTagLabel_integrationId_labelId_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast(),
//       table.labelId.asc().nullsLast()
//     ),
//     uniqueIndex('IntegrationTagLabel_integrationId_tagId_key').using(
//       'btree',
//       table.integrationId.asc().nullsLast(),
//       table.tagId.asc().nullsLast()
//     ),
//     index('IntegrationTagLabel_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.labelId],
//       foreignColumns: [label.id],
//       name: 'IntegrationTagLabel_labelId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'IntegrationTagLabel_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.tagId],
//       foreignColumns: [tag.id],
//       name: 'IntegrationTagLabel_tagId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const searchHistory = pgTable(
//   'SearchHistory',
//   {
//     id: text().primaryKey().notNull(),
//     userId: text().notNull(),
//     organizationId: text().notNull(),
//     query: text().notNull(),
//     searchedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('SearchHistory_userId_organizationId_searchedAt_idx').using(
//       'btree',
//       table.userId.asc().nullsLast(),
//       table.organizationId.asc().nullsLast(),
//       table.searchedAt.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'SearchHistory_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'SearchHistory_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const loadBalancingConfig = pgTable(
//   'LoadBalancingConfig',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     provider: text().notNull(),
//     model: text().notNull(),
//     modelType: text().notNull(),
//     name: text().notNull(),
//     credentials: jsonb(),
//     enabled: boolean().default(true).notNull(),
//     weight: integer().default(1).notNull(),
//   },
//   (table) => [
//     index('LoadBalancingConfig_organizationId_provider_model_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast(),
//       table.model.asc().nullsLast()
//     ),
//     uniqueIndex('LoadBalancingConfig_organizationId_provider_model_modelType_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast(),
//       table.model.asc().nullsLast(),
//       table.modelType.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'LoadBalancingConfig_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const providerPreference = pgTable(
//   'ProviderPreference',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     provider: text().notNull(),
//     preferredType: text().notNull(),
//   },
//   (table) => [
//     index('ProviderPreference_organizationId_provider_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast()
//     ),
//     uniqueIndex('ProviderPreference_organizationId_provider_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ProviderPreference_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const modelConfiguration = pgTable(
//   'ModelConfiguration',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     model: text().notNull(),
//     modelType: text().default('llm').notNull(),
//     enabled: boolean().default(true).notNull(),
//     config: jsonb().default({}).notNull(),
//     provider: text().notNull(),
//     credentials: jsonb(),
//   },
//   (table) => [
//     index('ModelConfiguration_organizationId_enabled_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.enabled.asc().nullsLast()
//     ),
//     index('ModelConfiguration_organizationId_provider_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast()
//     ),
//     uniqueIndex('ModelConfiguration_organizationId_provider_model_modelType_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast(),
//       table.model.asc().nullsLast(),
//       table.modelType.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ModelConfiguration_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const workflow = pgTable(
//   'Workflow',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     enabled: boolean().default(true).notNull(),
//     version: integer().default(1).notNull(),
//     triggerType: text(),
//     triggerConfig: jsonb(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     createdById: text(),
//     envVars: jsonb('env_vars'),
//     graph: jsonb(),
//     workflowAppId: text().notNull(),
//     variables: jsonb(),
//   },
//   (table) => [
//     index('Workflow_organizationId_enabled_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.enabled.asc().nullsLast()
//     ),
//     index('Workflow_organizationId_triggerType_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.triggerType.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Workflow_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Workflow_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.workflowAppId],
//       foreignColumns: [workflowApp.id],
//       name: 'Workflow_workflowAppId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const workflowApp = pgTable(
//   'WorkflowApp',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     description: text(),
//     enabled: boolean().default(true).notNull(),
//     createdById: text(),
//     isPublic: boolean().default(false).notNull(),
//     isUniversal: boolean().default(false).notNull(),
//     workflowId: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     draftWorkflowId: text(),
//   },
//   (table) => [
//     uniqueIndex('WorkflowApp_draftWorkflowId_key').using(
//       'btree',
//       table.draftWorkflowId.asc().nullsLast()
//     ),
//     index('WorkflowApp_organizationId_enabled_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.enabled.asc().nullsLast()
//     ),
//     index('WorkflowApp_organizationId_isPublic_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.isPublic.asc().nullsLast()
//     ),
//     uniqueIndex('WorkflowApp_workflowId_key').using('btree', table.workflowId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'WorkflowApp_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.draftWorkflowId],
//       foreignColumns: [workflow.id],
//       name: 'WorkflowApp_draftWorkflowId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'WorkflowApp_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.workflowId],
//       foreignColumns: [workflow.id],
//       name: 'WorkflowApp_workflowId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const providerConfiguration = pgTable(
//   'ProviderConfiguration',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     provider: text().notNull(),
//     providerType: text().notNull(),
//     credentials: jsonb(),
//     isEnabled: boolean().default(true).notNull(),
//     quotaType: text(),
//     quotaLimit: integer()
//       .default(sql`'-1'`)
//       .notNull(),
//     quotaPeriodEnd: timestamp({ precision: 3, mode: 'string' }),
//     quotaPeriodStart: timestamp({ precision: 3, mode: 'string' }),
//     quotaUsed: integer().default(0).notNull(),
//   },
//   (table) => [
//     index('ProviderConfiguration_organizationId_provider_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast()
//     ),
//     uniqueIndex('ProviderConfiguration_organizationId_provider_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.provider.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ProviderConfiguration_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const workflowRun = pgTable(
//   'WorkflowRun',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     workflowAppId: text().notNull(),
//     sequenceNumber: integer().notNull(),
//     workflowId: text().notNull(),
//     type: text().notNull(),
//     triggeredFrom: workflowTriggerSource().notNull(),
//     version: text().notNull(),
//     graph: jsonb().notNull(),
//     inputs: jsonb().notNull(),
//     outputs: jsonb(),
//     status: workflowRunStatus().notNull(),
//     error: text(),
//     elapsedTime: doublePrecision(),
//     totalTokens: integer().default(0).notNull(),
//     totalSteps: integer().default(0).notNull(),
//     createdBy: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     finishedAt: timestamp({ precision: 3, mode: 'string' }),
//     pausedAt: timestamp({ precision: 3, mode: 'string' }),
//     pausedNodeId: text(),
//     resumeAt: timestamp({ precision: 3, mode: 'string' }),
//     serializedState: jsonb(),
//   },
//   (table) => [
//     index('WorkflowRun_createdAt_idx').using('btree', table.createdAt.asc().nullsLast()),
//     index('WorkflowRun_organizationId_workflowAppId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.workflowAppId.asc().nullsLast()
//     ),
//     index('WorkflowRun_resumeAt_idx').using('btree', table.resumeAt.asc().nullsLast()),
//     index('WorkflowRun_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('WorkflowRun_workflowId_idx').using('btree', table.workflowId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdBy],
//       foreignColumns: [user.id],
//       name: 'WorkflowRun_createdBy_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'WorkflowRun_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.workflowAppId],
//       foreignColumns: [workflowApp.id],
//       name: 'WorkflowRun_workflowAppId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.workflowId],
//       foreignColumns: [workflow.id],
//       name: 'WorkflowRun_workflowId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const workflowNodeExecution = pgTable(
//   'WorkflowNodeExecution',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     workflowAppId: text().notNull(),
//     workflowId: text().notNull(),
//     triggeredFrom: nodeTriggerSource().notNull(),
//     workflowRunId: text(),
//     index: integer().notNull(),
//     predecessorNodeId: text(),
//     nodeId: text().notNull(),
//     nodeType: text().notNull(),
//     title: text().notNull(),
//     inputs: jsonb(),
//     processData: jsonb(),
//     outputs: jsonb(),
//     status: nodeExecutionStatus().notNull(),
//     error: text(),
//     elapsedTime: doublePrecision(),
//     executionMetadata: jsonb(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     finishedAt: timestamp({ precision: 3, mode: 'string' }),
//     createdById: text(),
//   },
//   (table) => [
//     index('WorkflowNodeExecution_nodeId_idx').using('btree', table.nodeId.asc().nullsLast()),
//     index('WorkflowNodeExecution_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('WorkflowNodeExecution_workflowRunId_idx').using(
//       'btree',
//       table.workflowRunId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'WorkflowNodeExecution_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'WorkflowNodeExecution_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.workflowRunId],
//       foreignColumns: [workflowRun.id],
//       name: 'WorkflowNodeExecution_workflowRunId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const approvalRequest = pgTable(
//   'ApprovalRequest',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     workflowId: text().notNull(),
//     workflowRunId: text().notNull(),
//     nodeId: text().notNull(),
//     nodeName: text().notNull(),
//     status: approvalStatus().default('pending').notNull(),
//     message: text(),
//     assigneeUsers: text().array(),
//     assigneeGroups: text().array(),
//     workflowName: text().notNull(),
//     createdById: text().notNull(),
//     metadata: jsonb(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }),
//   },
//   (table) => [
//     index('ApprovalRequest_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('ApprovalRequest_organizationId_assigneeGroups_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.assigneeGroups.asc().nullsLast()
//     ),
//     index('ApprovalRequest_organizationId_assigneeUsers_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.assigneeUsers.asc().nullsLast()
//     ),
//     index('ApprovalRequest_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('ApprovalRequest_status_expiresAt_idx').using(
//       'btree',
//       table.status.asc().nullsLast(),
//       table.expiresAt.asc().nullsLast()
//     ),
//     index('ApprovalRequest_workflowRunId_idx').using(
//       'btree',
//       table.workflowRunId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'ApprovalRequest_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ApprovalRequest_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.workflowId],
//       foreignColumns: [workflow.id],
//       name: 'ApprovalRequest_workflowId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.workflowRunId],
//       foreignColumns: [workflowRun.id],
//       name: 'ApprovalRequest_workflowRunId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//   ]
// )

// export const approvalResponse = pgTable(
//   'ApprovalResponse',
//   {
//     id: text().primaryKey().notNull(),
//     approvalRequestId: text().notNull(),
//     userId: text().notNull(),
//     action: approvalAction().notNull(),
//     respondedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     responseMethod: text().notNull(),
//     ipAddress: text(),
//     userAgent: text(),
//   },
//   (table) => [
//     uniqueIndex('ApprovalResponse_approvalRequestId_userId_key').using(
//       'btree',
//       table.approvalRequestId.asc().nullsLast(),
//       table.userId.asc().nullsLast()
//     ),
//     index('ApprovalResponse_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.approvalRequestId],
//       foreignColumns: [approvalRequest.id],
//       name: 'ApprovalResponse_approvalRequestId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'ApprovalResponse_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//   ]
// )

// export const file = pgTable(
//   'File',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     name: text(),
//     hashedKey: text().notNull(),
//     createdById: text(),
//     organizationId: text().notNull(),
//     size: integer().default(0).notNull(),
//     type: text(),
//     meta: jsonb().default({}).notNull(),
//     deletedAt: timestamp({ precision: 3, mode: 'string' }),
//     deletedById: text(),
//     entityId: text(),
//     entityType: text(),
//     articleId: text(),
//     knowledgeBaseId: text(),
//     checksum: text(),
//     confirmedAt: timestamp({ precision: 3, mode: 'string' }),
//     downloadCount: integer().default(0).notNull(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }),
//     lastAccessedAt: timestamp({ precision: 3, mode: 'string' }),
//     status: fileStatus().default('PENDING').notNull(),
//     visibility: fileVisibility().default('PRIVATE').notNull(),
//   },
//   (table) => [
//     index('File_checksum_organizationId_idx').using(
//       'btree',
//       table.checksum.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     uniqueIndex('File_hashedKey_key').using('btree', table.hashedKey.asc().nullsLast()),
//     index('File_organizationId_status_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.status.asc().nullsLast()
//     ),
//     index('File_status_expiresAt_idx').using(
//       'btree',
//       table.status.asc().nullsLast(),
//       table.expiresAt.asc().nullsLast()
//     ),
//     index('File_visibility_hashedKey_idx').using(
//       'btree',
//       table.visibility.asc().nullsLast(),
//       table.hashedKey.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.articleId],
//       foreignColumns: [article.id],
//       name: 'File_articleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'File_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.deletedById],
//       foreignColumns: [user.id],
//       name: 'File_deletedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.knowledgeBaseId],
//       foreignColumns: [knowledgeBase.id],
//       name: 'File_knowledgeBaseId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'File_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const workflowJoinState = pgTable(
//   'WorkflowJoinState',
//   {
//     id: text().primaryKey().notNull(),
//     executionId: text().notNull(),
//     joinNodeId: text().notNull(),
//     forkNodeId: text().notNull(),
//     expectedInputs: jsonb().notNull(),
//     completedInputs: jsonb().notNull(),
//     branchResults: jsonb().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     workflowId: text().notNull(),
//   },
//   (table) => [
//     index('WorkflowJoinState_executionId_idx').using('btree', table.executionId.asc().nullsLast()),
//     uniqueIndex('WorkflowJoinState_executionId_joinNodeId_key').using(
//       'btree',
//       table.executionId.asc().nullsLast(),
//       table.joinNodeId.asc().nullsLast()
//     ),
//     index('WorkflowJoinState_workflowId_idx').using('btree', table.workflowId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.workflowId],
//       foreignColumns: [workflow.id],
//       name: 'WorkflowJoinState_workflowId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const fileAttachment = pgTable(
//   'FileAttachment',
//   {
//     id: text().primaryKey().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     fileId: text().notNull(),
//     attachableId: text().notNull(),
//     attachableType: text().notNull(),
//     context: jsonb(),
//   },
//   (table) => [
//     index('FileAttachment_attachableId_attachableType_idx').using(
//       'btree',
//       table.attachableId.asc().nullsLast(),
//       table.attachableType.asc().nullsLast()
//     ),
//     uniqueIndex('FileAttachment_fileId_attachableId_attachableType_key').using(
//       'btree',
//       table.fileId.asc().nullsLast(),
//       table.attachableId.asc().nullsLast(),
//       table.attachableType.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.fileId],
//       foreignColumns: [file.id],
//       name: 'FileAttachment_fileId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const workflowFile = pgTable(
//   'WorkflowFile',
//   {
//     id: text().primaryKey().notNull(),
//     workflowId: text().notNull(),
//     fileId: text().notNull(),
//     nodeId: text().notNull(),
//     uploadedAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     uploadSource: text().default('local').notNull(),
//     originalUrl: text(),
//     expiresAt: timestamp({ precision: 3, mode: 'string' }),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('WorkflowFile_expiresAt_idx').using('btree', table.expiresAt.asc().nullsLast()),
//     index('WorkflowFile_nodeId_idx').using('btree', table.nodeId.asc().nullsLast()),
//     uniqueIndex('WorkflowFile_workflowId_fileId_key').using(
//       'btree',
//       table.workflowId.asc().nullsLast(),
//       table.fileId.asc().nullsLast()
//     ),
//     index('WorkflowFile_workflowId_idx').using('btree', table.workflowId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.fileId],
//       foreignColumns: [file.id],
//       name: 'WorkflowFile_fileId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.workflowId],
//       foreignColumns: [workflow.id],
//       name: 'WorkflowFile_workflowId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const workflowCredentials = pgTable(
//   'WorkflowCredentials',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//     name: text().notNull(),
//     type: text().notNull(),
//     encryptedData: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//   },
//   (table) => [
//     index('WorkflowCredentials_createdById_idx').using(
//       'btree',
//       table.createdById.asc().nullsLast()
//     ),
//     index('WorkflowCredentials_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('WorkflowCredentials_organizationId_type_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.type.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'WorkflowCredentials_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'WorkflowCredentials_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const dataset = pgTable(
//   'Dataset',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     description: text(),
//     status: datasetStatus().default('ACTIVE').notNull(),
//     isPublic: boolean().default(false).notNull(),
//     documentCount: integer().default(0).notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     totalSize: bigint({ mode: 'number' }).default(0).notNull(),
//     lastIndexedAt: timestamp({ precision: 3, mode: 'string' }),
//     chunkSize: integer().default(1000).notNull(),
//     chunkOverlap: integer().default(200).notNull(),
//     chunkingStrategy: chunkingStrategy().default('FIXED_SIZE').notNull(),
//     vectorDbConfig: jsonb(),
//     embeddingModel: text(),
//     vectorDimension: integer(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//     vectorDbType: vectorDbType().default('POSTGRESQL').notNull(),
//     embeddingModelProvider: text(),
//     searchConfig: jsonb().default({ searchType: 'hybrid' }).notNull(),
//   },
//   (table) => [
//     index('Dataset_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
//     index('Dataset_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     uniqueIndex('Dataset_organizationId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     index('Dataset_status_idx').using('btree', table.status.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Dataset_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Dataset_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const datasetSearchQuery = pgTable(
//   'DatasetSearchQuery',
//   {
//     id: text().primaryKey().notNull(),
//     query: text().notNull(),
//     queryType: text().default('hybrid').notNull(),
//     resultsCount: integer().default(0).notNull(),
//     vectorSimilarityThreshold: doublePrecision().default(0.7),
//     maxResults: integer().default(10).notNull(),
//     filters: jsonb(),
//     responseTime: integer().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     datasetId: text().notNull(),
//     organizationId: text().notNull(),
//     userId: text().notNull(),
//   },
//   (table) => [
//     index('DatasetSearchQuery_createdAt_idx').using('btree', table.createdAt.asc().nullsLast()),
//     index('DatasetSearchQuery_datasetId_idx').using('btree', table.datasetId.asc().nullsLast()),
//     index('DatasetSearchQuery_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('DatasetSearchQuery_userId_idx').using('btree', table.userId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.datasetId],
//       foreignColumns: [dataset.id],
//       name: 'DatasetSearchQuery_datasetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'DatasetSearchQuery_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.userId],
//       foreignColumns: [user.id],
//       name: 'DatasetSearchQuery_userId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const datasetSearchResult = pgTable(
//   'DatasetSearchResult',
//   {
//     id: text().primaryKey().notNull(),
//     rank: integer().notNull(),
//     score: doublePrecision().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     queryId: text().notNull(),
//     segmentId: text().notNull(),
//   },
//   (table) => [
//     index('DatasetSearchResult_queryId_idx').using('btree', table.queryId.asc().nullsLast()),
//     uniqueIndex('DatasetSearchResult_queryId_segmentId_key').using(
//       'btree',
//       table.queryId.asc().nullsLast(),
//       table.segmentId.asc().nullsLast()
//     ),
//     index('DatasetSearchResult_rank_idx').using('btree', table.rank.asc().nullsLast()),
//     index('DatasetSearchResult_score_idx').using('btree', table.score.asc().nullsLast()),
//     index('DatasetSearchResult_segmentId_idx').using('btree', table.segmentId.asc().nullsLast()),
//     foreignKey({
//       columns: [table.queryId],
//       foreignColumns: [datasetSearchQuery.id],
//       name: 'DatasetSearchResult_queryId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.segmentId],
//       foreignColumns: [documentSegment.id],
//       name: 'DatasetSearchResult_segmentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const externalKnowledgeSource = pgTable(
//   'ExternalKnowledgeSource',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     description: text(),
//     sourceType: text().notNull(),
//     endpoint: text(),
//     configuration: jsonb().notNull(),
//     syncEnabled: boolean().default(false).notNull(),
//     syncInterval: integer(),
//     lastSyncAt: timestamp({ precision: 3, mode: 'string' }),
//     nextSyncAt: timestamp({ precision: 3, mode: 'string' }),
//     status: text().default('inactive').notNull(),
//     errorMessage: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     datasetId: text().notNull(),
//     organizationId: text().notNull(),
//     createdById: text().notNull(),
//   },
//   (table) => [
//     index('ExternalKnowledgeSource_datasetId_idx').using(
//       'btree',
//       table.datasetId.asc().nullsLast()
//     ),
//     uniqueIndex('ExternalKnowledgeSource_datasetId_name_key').using(
//       'btree',
//       table.datasetId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     index('ExternalKnowledgeSource_nextSyncAt_idx').using(
//       'btree',
//       table.nextSyncAt.asc().nullsLast()
//     ),
//     index('ExternalKnowledgeSource_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('ExternalKnowledgeSource_status_idx').using('btree', table.status.asc().nullsLast()),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'ExternalKnowledgeSource_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.datasetId],
//       foreignColumns: [dataset.id],
//       name: 'ExternalKnowledgeSource_datasetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'ExternalKnowledgeSource_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const document = pgTable(
//   'Document',
//   {
//     id: text().primaryKey().notNull(),
//     title: text().notNull(),
//     filename: text().notNull(),
//     originalPath: text(),
//     mimeType: text().notNull(),
//     type: documentType().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     size: bigint({ mode: 'number' }).notNull(),
//     checksum: text().notNull(),
//     status: documentStatus().default('UPLOADED').notNull(),
//     content: text(),
//     processedAt: timestamp({ precision: 3, mode: 'string' }),
//     errorMessage: text(),
//     processingTime: integer(),
//     totalChunks: integer().default(0).notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     datasetId: text().notNull(),
//     organizationId: text().notNull(),
//     uploadedById: text(),
//     enabled: boolean().default(true).notNull(),
//     metadata: jsonb(),
//     mediaAssetId: text(),
//   },
//   (table) => [
//     index('Document_checksum_idx').using('btree', table.checksum.asc().nullsLast()),
//     uniqueIndex('Document_datasetId_checksum_key').using(
//       'btree',
//       table.datasetId.asc().nullsLast(),
//       table.checksum.asc().nullsLast()
//     ),
//     index('Document_datasetId_idx').using('btree', table.datasetId.asc().nullsLast()),
//     index('Document_enabled_idx').using('btree', table.enabled.asc().nullsLast()),
//     index('Document_mediaAssetId_idx').using('btree', table.mediaAssetId.asc().nullsLast()),
//     index('Document_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
//     index('Document_status_idx').using('btree', table.status.asc().nullsLast()),
//     index('Document_type_idx').using('btree', table.type.asc().nullsLast()),
//     index('Document_uploadedById_idx').using('btree', table.uploadedById.asc().nullsLast()),
//     foreignKey({
//       columns: [table.datasetId],
//       foreignColumns: [dataset.id],
//       name: 'Document_datasetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.mediaAssetId],
//       foreignColumns: [mediaAsset.id],
//       name: 'Document_mediaAssetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Document_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.uploadedById],
//       foreignColumns: [user.id],
//       name: 'Document_uploadedById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const documentSegment = pgTable(
//   'DocumentSegment',
//   {
//     id: text().primaryKey().notNull(),
//     content: text().notNull(),
//     position: integer().notNull(),
//     startOffset: integer().notNull(),
//     endOffset: integer().notNull(),
//     tokenCount: integer().notNull(),
//     embedding: vector({ dimensions: 1536 }),
//     embeddingModel: text(),
//     metadata: jsonb(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     documentId: text().notNull(),
//     organizationId: text().notNull(),
//     enabled: boolean().default(true).notNull(),
//     indexStatus: indexStatus().default('PENDING').notNull(),
//     searchMetadata: jsonb(),
//   },
//   (table) => [
//     index('DocumentSegment_documentId_idx').using('btree', table.documentId.asc().nullsLast()),
//     index('DocumentSegment_organizationId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast()
//     ),
//     index('DocumentSegment_position_idx').using('btree', table.position.asc().nullsLast()),
//     index('idx_document_segment_active_embedding')
//       .using('hnsw', table.embedding.op('vector_l2_ops'))
//       .where(
//         sql`((enabled = true) AND ("indexStatus" = 'INDEXED'::"IndexStatus") AND (embedding IS NOT NULL))`
//       )
//       .with({ m: '16', ef_construction: '64' }),
//     index('idx_document_segment_content_search').using(
//       'gin',
//       sql`to_tsvector('english'::regconfig, content)`
//     ),
//     index('idx_document_segment_dataset_filter')
//       .using('btree', table.documentId.asc().nullsLast())
//       .where(
//         sql`((enabled = true) AND ("indexStatus" = 'INDEXED'::"IndexStatus") AND (embedding IS NOT NULL))`
//       ),
//     foreignKey({
//       columns: [table.documentId],
//       foreignColumns: [document.id],
//       name: 'DocumentSegment_documentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'DocumentSegment_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const datasetMetadata = pgTable(
//   'DatasetMetadata',
//   {
//     id: text().primaryKey().notNull(),
//     name: text().notNull(),
//     type: text().default('string').notNull(),
//     count: integer().default(0).notNull(),
//     datasetId: text().notNull(),
//   },
//   (table) => [
//     index('DatasetMetadata_datasetId_idx').using('btree', table.datasetId.asc().nullsLast()),
//     uniqueIndex('DatasetMetadata_datasetId_name_key').using(
//       'btree',
//       table.datasetId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     index('DatasetMetadata_type_idx').using('btree', table.type.asc().nullsLast()),
//     foreignKey({
//       columns: [table.datasetId],
//       foreignColumns: [dataset.id],
//       name: 'DatasetMetadata_datasetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const storageLocation = pgTable(
//   'StorageLocation',
//   {
//     id: text().primaryKey().notNull(),
//     provider: storageProvider().notNull(),
//     externalId: text().notNull(),
//     externalUrl: text().notNull(),
//     externalRev: text().notNull(),
//     credentialId: text(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     size: bigint({ mode: 'number' }).default(0),
//     mimeType: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     metadata: jsonb().default({}).notNull(),
//   },
//   (table) => [
//     index('StorageLocation_credentialId_idx').using('btree', table.credentialId.asc().nullsLast()),
//     index('StorageLocation_provider_externalId_idx').using(
//       'btree',
//       table.provider.asc().nullsLast(),
//       table.externalId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.credentialId],
//       foreignColumns: [workflowCredentials.id],
//       name: 'StorageLocation_credentialId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const folder = pgTable(
//   'Folder',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     name: text().notNull(),
//     parentId: text(),
//     path: text(),
//     depth: integer().default(0).notNull(),
//     createdById: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     deletedAt: timestamp({ precision: 3, mode: 'string' }),
//     isArchived: boolean().default(false).notNull(),
//   },
//   (table) => [
//     index('Folder_organizationId_deletedAt_isArchived_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.deletedAt.asc().nullsLast(),
//       table.isArchived.asc().nullsLast()
//     ),
//     index('Folder_organizationId_depth_path_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.depth.asc().nullsLast(),
//       table.path.asc().nullsLast()
//     ),
//     index('Folder_organizationId_parentId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.parentId.asc().nullsLast()
//     ),
//     uniqueIndex('Folder_organizationId_parentId_name_key').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.parentId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     index('Folder_parentId_name_idx').using(
//       'btree',
//       table.parentId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Folder_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Folder_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.parentId],
//       foreignColumns: [table.id],
//       name: 'Folder_parentId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//   ]
// )

// export const fileVersion = pgTable(
//   'FileVersion',
//   {
//     id: text().primaryKey().notNull(),
//     fileId: text().notNull(),
//     versionNumber: integer().notNull(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     size: bigint({ mode: 'number' }),
//     checksum: text(),
//     mimeType: text(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     storageLocationId: text().notNull(),
//   },
//   (table) => [
//     index('FileVersion_fileId_createdAt_idx').using(
//       'btree',
//       table.fileId.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     uniqueIndex('FileVersion_fileId_versionNumber_key').using(
//       'btree',
//       table.fileId.asc().nullsLast(),
//       table.versionNumber.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.fileId],
//       foreignColumns: [folderFile.id],
//       name: 'FileVersion_fileId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.storageLocationId],
//       foreignColumns: [storageLocation.id],
//       name: 'FileVersion_storageLocationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const uploadSession = pgTable(
//   'UploadSession',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     provider: storageProvider().default('S3').notNull(),
//     externalId: text(),
//     credentialId: text(),
//     fileName: text().notNull(),
//     mimeType: text(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     expectedSize: bigint({ mode: 'number' }),
//     checksum: text(),
//     createdById: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     completedAt: timestamp({ precision: 3, mode: 'string' }),
//     canceledAt: timestamp({ precision: 3, mode: 'string' }),
//     metadata: jsonb(),
//   },
//   (table) => [
//     index('UploadSession_organizationId_createdById_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.createdById.asc().nullsLast()
//     ),
//     index('UploadSession_provider_externalId_idx').using(
//       'btree',
//       table.provider.asc().nullsLast(),
//       table.externalId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'UploadSession_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const attachment = pgTable(
//   'Attachment',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     entityType: text().notNull(),
//     entityId: text().notNull(),
//     role: text().default('ATTACHMENT').notNull(),
//     title: text(),
//     caption: text(),
//     sort: integer().default(0).notNull(),
//     fileId: text(),
//     fileVersionId: text(),
//     assetId: text(),
//     assetVersionId: text(),
//     createdById: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//   },
//   (table) => [
//     index('Attachment_assetId_idx').using('btree', table.assetId.asc().nullsLast()),
//     index('Attachment_createdAt_idx').using('btree', table.createdAt.asc().nullsLast()),
//     index('Attachment_entityType_entityId_idx').using(
//       'btree',
//       table.entityType.asc().nullsLast(),
//       table.entityId.asc().nullsLast()
//     ),
//     index('Attachment_fileId_idx').using('btree', table.fileId.asc().nullsLast()),
//     uniqueIndex('Attachment_id_organizationId_key').using(
//       'btree',
//       table.id.asc().nullsLast(),
//       table.organizationId.asc().nullsLast()
//     ),
//     index('Attachment_organizationId_entityType_entityId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.entityType.asc().nullsLast(),
//       table.entityId.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.assetId],
//       foreignColumns: [mediaAsset.id],
//       name: 'Attachment_assetId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.assetVersionId],
//       foreignColumns: [mediaAssetVersion.id],
//       name: 'Attachment_assetVersionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'Attachment_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.fileId],
//       foreignColumns: [folderFile.id],
//       name: 'Attachment_fileId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.fileVersionId],
//       foreignColumns: [fileVersion.id],
//       name: 'Attachment_fileVersionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'Attachment_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const folderFile = pgTable(
//   'FolderFile',
//   {
//     id: text().primaryKey().notNull(),
//     organizationId: text().notNull(),
//     folderId: text(),
//     name: text().notNull(),
//     path: text().notNull(),
//     ext: text(),
//     mimeType: text(),
//     // You can use { mode: "bigint" } if numbers are exceeding js number limitations
//     size: bigint({ mode: 'number' }),
//     checksum: text(),
//     currentVersionId: text(),
//     isArchived: boolean().default(false).notNull(),
//     deletedAt: timestamp({ precision: 3, mode: 'string' }),
//     createdById: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
//     provider: storageProvider(),
//   },
//   (table) => [
//     uniqueIndex('FolderFile_currentVersionId_key').using(
//       'btree',
//       table.currentVersionId.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_checksum_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.checksum.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_deletedAt_isArchived_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.deletedAt.asc().nullsLast(),
//       table.isArchived.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_ext_createdAt_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.ext.asc().nullsLast(),
//       table.createdAt.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_folderId_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.folderId.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_folderId_path_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.folderId.asc().nullsLast(),
//       table.path.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_mimeType_updatedAt_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.mimeType.asc().nullsLast(),
//       table.updatedAt.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_name_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_path_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.path.asc().nullsLast()
//     ),
//     index('FolderFile_organizationId_updatedAt_idx').using(
//       'btree',
//       table.organizationId.asc().nullsLast(),
//       table.updatedAt.asc().nullsLast()
//     ),
//     index('FolderFile_path_name_idx').using(
//       'btree',
//       table.path.asc().nullsLast(),
//       table.name.asc().nullsLast()
//     ),
//     foreignKey({
//       columns: [table.createdById],
//       foreignColumns: [user.id],
//       name: 'FolderFile_createdById_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('restrict'),
//     foreignKey({
//       columns: [table.currentVersionId],
//       foreignColumns: [fileVersion.id],
//       name: 'FolderFile_currentVersionId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.folderId],
//       foreignColumns: [folder.id],
//       name: 'FolderFile_folderId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('set null'),
//     foreignKey({
//       columns: [table.organizationId],
//       foreignColumns: [organization.id],
//       name: 'FolderFile_organizationId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//   ]
// )

// export const labelsOnThread = pgTable(
//   'LabelsOnThread',
//   {
//     threadId: text().notNull(),
//     labelId: text().notNull(),
//   },
//   (table) => [
//     foreignKey({
//       columns: [table.labelId],
//       foreignColumns: [label.id],
//       name: 'LabelsOnThread_labelId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'LabelsOnThread_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     primaryKey({ columns: [table.threadId, table.labelId], name: 'LabelsOnThread_pkey' }),
//   ]
// )

// export const tagsOnArticle = pgTable(
//   'TagsOnArticle',
//   {
//     articleId: text().notNull(),
//     tagId: text().notNull(),
//   },
//   (table) => [
//     foreignKey({
//       columns: [table.articleId],
//       foreignColumns: [article.id],
//       name: 'TagsOnArticle_articleId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.tagId],
//       foreignColumns: [articleTag.id],
//       name: 'TagsOnArticle_tagId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     primaryKey({ columns: [table.articleId, table.tagId], name: 'TagsOnArticle_pkey' }),
//   ]
// )

// export const tagsOnThread = pgTable(
//   'TagsOnThread',
//   {
//     tagId: text().notNull(),
//     threadId: text().notNull(),
//     createdAt: timestamp({ precision: 3, mode: 'string' })
//       .default(sql`CURRENT_TIMESTAMP`)
//       .notNull(),
//     createdBy: text(),
//   },
//   (table) => [
//     foreignKey({
//       columns: [table.tagId],
//       foreignColumns: [tag.id],
//       name: 'TagsOnThread_tagId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     foreignKey({
//       columns: [table.threadId],
//       foreignColumns: [thread.id],
//       name: 'TagsOnThread_threadId_fkey',
//     })
//       .onUpdate('cascade')
//       .onDelete('cascade'),
//     primaryKey({ columns: [table.tagId, table.threadId], name: 'TagsOnThread_pkey' }),
//   ]
// )
