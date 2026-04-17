// packages/database/src/types.ts
// Client-safe enum types generated from Drizzle enums

import type * as Enums from './enums'

export type ActionType = (typeof Enums.ActionTypeValues)[number]

export type AiIntegrationStatus = (typeof Enums.AiIntegrationStatusValues)[number]

export type ApprovalAction = (typeof Enums.ApprovalActionValues)[number]

export type ApprovalStatus = (typeof Enums.ApprovalStatusValues)[number]

export type ArticleStatus = (typeof Enums.ArticleStatusValues)[number]

export type AssetVersionStatus = (typeof Enums.AssetVersionStatusValues)[number]

export type BillingCycle = (typeof Enums.BillingCycleValues)[number]

export type ChunkingStrategy = (typeof Enums.ChunkingStrategyValues)[number]

export type FieldType = (typeof Enums.FieldTypeValues)[number]

export type CustomerSourceType = (typeof Enums.CustomerSourceTypeValues)[number]

export type CustomerStatus = (typeof Enums.CustomerStatusValues)[number]

export type DatasetStatus = (typeof Enums.DatasetStatusValues)[number]

export type DeliveryStatus = (typeof Enums.DeliveryStatusValues)[number]

export type DocumentStatus = (typeof Enums.DocumentStatusValues)[number]

export type DocumentType = (typeof Enums.DocumentTypeValues)[number]

export type DomainType = (typeof Enums.DomainTypeValues)[number]

export type DraftMode = (typeof Enums.DraftModeValues)[number]

export type EmailLabel = (typeof Enums.EmailLabelValues)[number]

export type EmailProvider = (typeof Enums.EmailProviderValues)[number]

export type EmailTemplateType = (typeof Enums.EmailTemplateTypeValues)[number]

export type ExtractionRuleType = (typeof Enums.ExtractionRuleTypeValues)[number]

export type FULFILLMENT_STATUS = (typeof Enums.FULFILLMENT_STATUSValues)[number]

export type FileStatus = (typeof Enums.FileStatusValues)[number]

export type FileVisibility = (typeof Enums.FileVisibilityValues)[number]

export type INVENTORY_POLICY = (typeof Enums.INVENTORY_POLICYValues)[number]

export type IdentifierType = (typeof Enums.IdentifierTypeValues)[number]

export type InboxStatus = (typeof Enums.InboxStatusValues)[number]

export type IndexStatus = (typeof Enums.IndexStatusValues)[number]

export type IntegrationAuthStatus = (typeof Enums.IntegrationAuthStatusValues)[number]

export type IntegrationSyncStage = (typeof Enums.IntegrationSyncStageValues)[number]

export type IntegrationSyncStatus = (typeof Enums.IntegrationSyncStatusValues)[number]

export type IntegrationProviderType = (typeof Enums.IntegrationProviderTypeValues)[number]

export type InvitationStatus = (typeof Enums.InvitationStatusValues)[number]

export type InvoiceStatus = (typeof Enums.InvoiceStatusValues)[number]

export type JobStatus = (typeof Enums.JobStatusValues)[number]

export type LabelType = (typeof Enums.LabelTypeValues)[number]

export type MEDIA_CONTENT_TYPE = (typeof Enums.MEDIA_CONTENT_TYPEValues)[number]

export type MeetingMessageMethod = (typeof Enums.MeetingMessageMethodValues)[number]

export type MessageType = (typeof Enums.MessageTypeValues)[number]

export type AiModelType = (typeof Enums.AiModelTypeValues)[number]

// Re-export ModelType from enums (the canonical definition for data models)
export type { ModelType } from './enums'

export type NodeExecutionStatus = (typeof Enums.NodeExecutionStatusValues)[number]

export type NodeTriggerSource = (typeof Enums.NodeTriggerSourceValues)[number]

export type NotificationType = (typeof Enums.NotificationTypeValues)[number]

export type ORDER_ADDRESS_TYPE = (typeof Enums.ORDER_ADDRESS_TYPEValues)[number]

export type ORDER_CANCEL_REASON = (typeof Enums.ORDER_CANCEL_REASONValues)[number]

export type ORDER_FINANCIAL_STATUS = (typeof Enums.ORDER_FINANCIAL_STATUSValues)[number]

export type ORDER_FULFILLMENT_STATUS = (typeof Enums.ORDER_FULFILLMENT_STATUSValues)[number]

export type ORDER_RETURN_STATUS = (typeof Enums.ORDER_RETURN_STATUSValues)[number]

export type OrganizationMemberStatus = (typeof Enums.OrganizationMemberStatusValues)[number]

export type OrganizationRole = (typeof Enums.OrganizationRoleValues)[number]

export type OrganizationType = (typeof Enums.OrganizationTypeValues)[number]

export type PRODUDT_STATUS = (typeof Enums.PRODUDT_STATUSValues)[number]

export type ParticipantRole = (typeof Enums.ParticipantRoleValues)[number]

export type ProposedActionStatus = (typeof Enums.ProposedActionStatusValues)[number]

export type ProviderQuotaType = (typeof Enums.ProviderQuotaTypeValues)[number]

export type ProviderType = (typeof Enums.ProviderTypeValues)[number]

export type RETURN_STATUS = (typeof Enums.RETURN_STATUSValues)[number]

export type RecipientRole = (typeof Enums.RecipientRoleValues)[number]

export type ResponseStatus = (typeof Enums.ResponseStatusValues)[number]

export type ResponseType = (typeof Enums.ResponseTypeValues)[number]

export type RuleGroupOperator = (typeof Enums.RuleGroupOperatorValues)[number]

export type RuleType = (typeof Enums.RuleTypeValues)[number]

export type SYNC_STATUS = (typeof Enums.SYNC_STATUSValues)[number]

export type SendStatus = (typeof Enums.SendStatusValues)[number]

export type SenderType = (typeof Enums.SenderTypeValues)[number]

export type Sensitivity = (typeof Enums.SensitivityValues)[number]

export type SettingScope = (typeof Enums.SettingScopeValues)[number]

export type SignatureSharingType = (typeof Enums.SignatureSharingTypeValues)[number]

export type SnippetPermission = (typeof Enums.SnippetPermissionValues)[number]

export type SnippetSharingType = (typeof Enums.SnippetSharingTypeValues)[number]

export type StaticRuleType = (typeof Enums.StaticRuleTypeValues)[number]

export type StorageProvider = (typeof Enums.StorageProviderValues)[number]

export type SubscriptionStatus = (typeof Enums.SubscriptionStatusValues)[number]

export type ThreadStatus = (typeof Enums.ThreadStatusValues)[number]

export type ThreadType = (typeof Enums.ThreadTypeValues)[number]

export type TicketPriority = (typeof Enums.TicketPriorityValues)[number]

export type TicketStatus = (typeof Enums.TicketStatusValues)[number]

export type TicketType = (typeof Enums.TicketTypeValues)[number]

export type TrialConversionStatus = (typeof Enums.TrialConversionStatusValues)[number]

export type UserType = (typeof Enums.UserTypeValues)[number]

export type VectorDbType = (typeof Enums.VectorDbTypeValues)[number]

export type WorkflowRunStatus = (typeof Enums.WorkflowRunStatusValues)[number]

export type WorkflowTriggerSource = (typeof Enums.WorkflowTriggerSourceValues)[number]

// EntityDefinition types (nullable since stored as text fields)
export type EntityType = (typeof Enums.EntityTypeValues)[number] | null

export type StandardType = (typeof Enums.StandardTypeValues)[number] | null

export type { ApprovalRequestEntity } from './db/schema/approval-request'
export type { AttachmentEntity } from './db/schema/attachment'
export type { CommentEntity } from './db/schema/comment'
export type { CommentReactionEntity } from './db/schema/comment-reaction'
export type { CustomFieldEntity } from './db/schema/custom-field'
// Entity types (inferred from schema — client-safe, no runtime imports)
export type { DatasetEntity } from './db/schema/dataset'
export type { DatasetSearchQueryEntity } from './db/schema/dataset-search-query'
export type { DatasetSearchResultEntity } from './db/schema/dataset-search-result'
export type { DocumentEntity } from './db/schema/document'
export type { DocumentSegmentEntity } from './db/schema/document-segment'
export type { EntityDefinitionEntity } from './db/schema/entity-definition'
export type { EntityInstanceEntity } from './db/schema/entity-instance'
export type { EventEntity } from './db/schema/event'
export type { ExternalKnowledgeSourceEntity } from './db/schema/external-knowledge-source'
export type { FileVersionEntity } from './db/schema/file-version'
export type { FolderEntity } from './db/schema/folder'
export type { FolderFileEntity } from './db/schema/folder-file'
export type { IntegrationEntity } from './db/schema/integration'
export type { LoadBalancingConfigEntity } from './db/schema/load-balancing-config'
export type {
  CreateMailViewInput,
  MailViewEntity,
  UpdateMailViewInput,
} from './db/schema/mail-view'
export type { MediaAssetEntity } from './db/schema/media-asset'
export type { MediaAssetVersionEntity } from './db/schema/media-asset-version'
export type { MessageEntity } from './db/schema/message'
export type { MessageParticipantEntity } from './db/schema/message-participant'
export type { ModelConfigurationEntity } from './db/schema/model-configuration'
export type { OrganizationEntity } from './db/schema/organization'
export type { OrganizationInvitationEntity } from './db/schema/organization-invitation'
export type {
  OrganizationMemberEntity,
  OrganizationMemberInfo,
} from './db/schema/organization-member'
export type { ParticipantEntity } from './db/schema/participant'
export type { ProviderConfigurationEntity } from './db/schema/provider-configuration'
export type { ProviderPreferenceEntity } from './db/schema/provider-preference'
export type { ShopifyIntegrationEntity } from './db/schema/shopify-integration'
export type {
  CreateStorageLocationInput,
  StorageLocationEntity,
} from './db/schema/storage-location'
export type { TableViewEntity } from './db/schema/table-view'
export type { ThreadEntity } from './db/schema/thread'
export type { TimelineEventEntity } from './db/schema/timeline-event'
export type { UserEntity } from './db/schema/user'
export type { WebhookEntity } from './db/schema/webhook'
export type { WebhookEventEntity } from './db/schema/webhook-event'
export type { WorkflowEntity } from './db/schema/workflow'
export type { WorkflowAppEntity } from './db/schema/workflow-app'
export type { WorkflowNodeExecutionEntity } from './db/schema/workflow-node-execution'
export type { WorkflowRunEntity } from './db/schema/workflow-run'
// ChunkSettings types
export type {
  ChunkPreprocessingOptions,
  ChunkSettings,
} from './types/chunk-settings'
export { DEFAULT_CHUNK_SETTINGS } from './types/chunk-settings'
