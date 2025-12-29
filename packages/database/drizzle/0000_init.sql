CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ActionType" AS ENUM('ARCHIVE', 'LABEL', 'REPLY', 'FORWARD', 'MARK_SPAM', 'DRAFT_EMAIL', 'SEND_MESSAGE', 'APPLY_TAG', 'REMOVE_TAG', 'APPLY_LABEL', 'REMOVE_LABEL', 'MARK_TRASH', 'ASSIGN_THREAD', 'ARCHIVE_THREAD', 'UNARCHIVE_THREAD', 'MOVE_TO_TRASH', 'REACT_TO_MESSAGE', 'SHARE_MESSAGE', 'SEND_SMS', 'MAKE_CALL', 'ESCALATE', 'ASSIGN', 'NOTIFY', 'CREATE_TICKET', 'SHOPIFY_ORDER_LOOKUP', 'SHOPIFY_GENERATE_RESPONSE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."AiIntegrationStatus" AS ENUM('PENDING', 'VALID', 'INVALID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ApprovalAction" AS ENUM('approve', 'deny');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ApprovalStatus" AS ENUM('pending', 'approved', 'denied', 'timeout');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ArticleStatus" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."AssetVersionStatus" AS ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."BillingCycle" AS ENUM('MONTHLY', 'ANNUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ChunkingStrategy" AS ENUM('FIXED_SIZE', 'SEMANTIC', 'SENTENCE', 'PARAGRAPH', 'DOCUMENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ContactFieldType" AS ENUM('PHONE', 'EMAIL', 'ADDRESS', 'URL', 'TAGS', 'DATE', 'CHECKBOX', 'TEXT', 'NUMBER', 'MULTI_SELECT', 'SINGLE_SELECT', 'RICH_TEXT', 'PHONE_INTL', 'ADDRESS_STRUCT', 'FILE', 'NAME');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."CustomerSourceType" AS ENUM('EMAIL', 'TICKET_SYSTEM', 'SHOPIFY', 'MANUAL', 'OTHER', 'FACEBOOK_PSID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."CustomerStatus" AS ENUM('ACTIVE', 'INACTIVE', 'SPAM', 'MERGED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."DataModelType" AS ENUM('CONTACT', 'COMPANY', 'CONVERSATION', 'TICKET');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."DatasetStatus" AS ENUM('ACTIVE', 'INACTIVE', 'PROCESSING', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."DeliveryStatus" AS ENUM('DELIVERED', 'BOUNCED', 'DELAYED', 'DEFERRED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."DocumentStatus" AS ENUM('UPLOADED', 'PROCESSING', 'INDEXED', 'FAILED', 'ARCHIVED', 'WAITING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."DocumentType" AS ENUM('PDF', 'DOCX', 'TXT', 'HTML', 'MARKDOWN', 'CSV', 'JSON', 'XML');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."DomainType" AS ENUM('CUSTOM', 'PROVIDER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."DraftMode" AS ENUM('NONE', 'PRIVATE', 'SHARED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."EmailLabel" AS ENUM('inbox', 'sent', 'draft');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."EmailProvider" AS ENUM('GMAIL', 'OUTLOOK', 'IMAP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."EmailTemplateType" AS ENUM('TICKET_CREATED', 'TICKET_REPLIED', 'TICKET_CLOSED', 'TICKET_REOPENED', 'TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ExtractionRuleType" AS ENUM('REGEX', 'MARKER', 'POSITION', 'AI_ASSISTED', 'VISUAL_SELECTION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."FileStatus" AS ENUM('PENDING', 'CONFIRMED', 'ARCHIVED', 'DELETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."FileVisibility" AS ENUM('PUBLIC', 'PRIVATE', 'INTERNAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."FULFILLMENT_STATUS" AS ENUM('CANCELLED', 'ERROR', 'FAILURE', 'SUCCESS', 'OPEN', 'PENDING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."IdentifierType" AS ENUM('EMAIL', 'PHONE', 'FACEBOOK_PSID', 'INSTAGRAM_IGSID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."InboxStatus" AS ENUM('ACTIVE', 'ARCHIVED', 'PAUSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."IndexStatus" AS ENUM('PENDING', 'INDEXED', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."IntegrationAuthStatus" AS ENUM('AUTHENTICATED', 'UNAUTHENTICATED', 'ERROR', 'INVALID_GRANT', 'EXPIRED_TOKEN', 'REVOKED_ACCESS', 'INSUFFICIENT_SCOPE', 'RATE_LIMITED', 'PROVIDER_ERROR', 'NETWORK_ERROR', 'UNKNOWN_ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."IntegrationProviderType" AS ENUM('google', 'outlook', 'facebook', 'instagram', 'openphone', 'mailgun', 'sms', 'whatsapp', 'chat', 'email', 'shopify');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."IntegrationType" AS ENUM('GOOGLE', 'OUTLOOK', 'OPENPHONE', 'FACEBOOK', 'INSTAGRAM', 'CHAT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."INVENTORY_POLICY" AS ENUM('CONTINUE', 'DENY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."InvitationStatus" AS ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."InvoiceStatus" AS ENUM('PENDING', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'DRAFT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."JobStatus" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED_SUCCESS', 'COMPLETED_PARTIAL', 'COMPLETED_FAILURE', 'FAILED', 'RETRYING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."LabelType" AS ENUM('system', 'user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."MEDIA_CONTENT_TYPE" AS ENUM('EXTERNAL_VIDEO', 'IMAGE', 'MODEL_3D', 'VIDEO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."MeetingMessageMethod" AS ENUM('request', 'reply', 'cancel', 'counter', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."MessageType" AS ENUM('EMAIL', 'FACEBOOK', 'SMS', 'WHATSAPP', 'INSTAGRAM', 'OPENPHONE', 'CHAT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ModelType" AS ENUM('LLM', 'TEXT_EMBEDDING', 'RERANK', 'TTS', 'SPEECH2TEXT', 'MODERATION', 'VISION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."NodeExecutionStatus" AS ENUM('pending', 'running', 'succeeded', 'failed', 'exception', 'skipped', 'stopped', 'waiting');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."NodeTriggerSource" AS ENUM('SINGLE_STEP', 'WORKFLOW_RUN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."NotificationType" AS ENUM('COMMENT_MENTION', 'COMMENT_REPLY', 'COMMENT_REACTION', 'TICKET_ASSIGNED', 'TICKET_UPDATED', 'TICKET_MENTIONED', 'THREAD_ACTIVITY', 'SYSTEM_MESSAGE', 'WORKFLOW_APPROVAL_REQUIRED', 'WORKFLOW_APPROVAL_REMINDER', 'WORKFLOW_APPROVAL_COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ORDER_ADDRESS_TYPE" AS ENUM('SHIPPING', 'BILLING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ORDER_CANCEL_REASON" AS ENUM('CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'OTHER', 'STAFF');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ORDER_FINANCIAL_STATUS" AS ENUM('AUTHORIZED', 'EXPIRED', 'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'PENDING', 'REFUNDED', 'VOIDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ORDER_FULFILLMENT_STATUS" AS ENUM('FULFILLED', 'IN_PROGRESS', 'ON_HOLD', 'OPEN', 'PARTIALLY_FULFILLED', 'PENDING_FULFILLMENT', 'REQUEST_DECLINED', 'RESTOCKED', 'SCHEDULED', 'UNFULFILLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ORDER_RETURN_STATUS" AS ENUM('INSPECTION_COMPLETED', 'IN_PROGRESS', 'NO_RETURN', 'RETURNED', 'RETURN_FAILED', 'RETURN_REQUESTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."OrganizationMemberStatus" AS ENUM('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."OrganizationRole" AS ENUM('OWNER', 'ADMIN', 'USER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."OrganizationType" AS ENUM('INDIVIDUAL', 'TEAM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ParticipantRole" AS ENUM('FROM', 'TO', 'CC', 'BCC', 'REPLY_TO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."PRODUDT_STATUS" AS ENUM('ACTIVE', 'ARCHIVED', 'DRAFT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ProposedActionStatus" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ProviderQuotaType" AS ENUM('PAID', 'FREE', 'TRIAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ProviderType" AS ENUM('SYSTEM', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."RecipientRole" AS ENUM('FROM', 'TO', 'CC', 'BCC');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ResponseStatus" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ResponseType" AS ENUM('MANUAL', 'TEMPLATE', 'AI_GENERATED', 'RULE_BASED', 'HYBRID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."RETURN_STATUS" AS ENUM('CANCELLED', 'CLOSED', 'DECLINED', 'OPEN', 'REQUESTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."RuleGroupOperator" AS ENUM('AND', 'OR', 'NOT', 'XOR', 'THRESHOLD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."RuleType" AS ENUM('STATIC', 'CATEGORY', 'AI', 'SPAM_HANDLER', 'RULE_GROUP', 'SHOPIFY_AUTOMATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SendStatus" AS ENUM('PENDING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SenderType" AS ENUM('INTERNAL_STAFF', 'INTERNAL_SYSTEM', 'PARTNER', 'CUSTOMER', 'VENDOR', 'UNKNOWN_EXTERNAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."Sensitivity" AS ENUM('normal', 'private', 'personal', 'confidential');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SettingScope" AS ENUM('APPEARANCE', 'NOTIFICATION', 'DASHBOARD', 'COMMUNICATION', 'SECURITY', 'INTEGRATION', 'GENERAL', 'SIDEBAR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SignatureSharingType" AS ENUM('PRIVATE', 'ORGANIZATION_WIDE', 'SPECIFIC_INTEGRATIONS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SnippetPermission" AS ENUM('VIEW', 'EDIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SnippetSharingType" AS ENUM('PRIVATE', 'ORGANIZATION', 'GROUPS', 'MEMBERS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."StaticRuleType" AS ENUM('SENDER_DOMAIN', 'SENDER_ADDRESS', 'RECIPIENT_PATTERN', 'SUBJECT_MATCH', 'BODY_KEYWORD', 'HEADER_CHECK', 'ATTACHMENT_TYPE', 'COMBINED', 'INTERNAL_EXTERNAL', 'THREAD_BASED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."StorageProvider" AS ENUM('S3', 'GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE', 'BOX', 'GENERIC_URL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SubscriptionStatus" AS ENUM('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING', 'UNPAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."SYNC_STATUS" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."TestCaseStatus" AS ENUM('ACTIVE', 'INACTIVE', 'DRAFT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."TestRunStatus" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ThreadStatus" AS ENUM('OPEN', 'ARCHIVED', 'ACTIVE', 'RESOLVED', 'PENDING', 'CLOSED', 'SPAM', 'TRASH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ThreadTrackerType" AS ENUM('AWAITING', 'NEEDS_REPLY', 'NEEDS_ACTION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."ThreadType" AS ENUM('EMAIL', 'CHAT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."TicketPriority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."TicketStatus" AS ENUM('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_THIRD_PARTY', 'RESOLVED', 'CLOSED', 'CANCELLED', 'MERGED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."TicketType" AS ENUM('GENERAL', 'MISSING_ITEM', 'RETURN', 'REFUND', 'PRODUCT_ISSUE', 'SHIPPING_ISSUE', 'BILLING', 'TECHNICAL', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."TrialConversionStatus" AS ENUM('TRIAL_ACTIVE', 'CONVERTED_TO_PAID', 'EXPIRED_WITHOUT_CONVERSION', 'CANCELED_DURING_TRIAL', 'MANUAL_CONVERSION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."UserType" AS ENUM('USER', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."VectorDbType" AS ENUM('POSTGRESQL', 'CHROMA', 'QDRANT', 'WEAVIATE', 'PINECONE', 'MILVUS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."WorkflowRunStatus" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'STOPPED', 'WAITING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."WorkflowTriggerSource" AS ENUM('DEBUGGING', 'APP_RUN', 'SINGLE_STEP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"finished_at" timestamp with time zone,
	"migration_name" varchar(255) NOT NULL,
	"logs" text,
	"rolled_back_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_steps_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"providerId" text NOT NULL,
	"accountId" text NOT NULL,
	"refreshToken" text,
	"accessToken" text,
	"accessTokenExpiresAt" timestamp (3),
	"refreshTokenExpiresAt" timestamp (3),
	"token_type" text,
	"scope" text,
	"idToken" text,
	"session_state" text,
	"lastHistoryId" text,
	"password" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Address" (
	"id" bigint PRIMARY KEY NOT NULL,
	"address1" text,
	"address2" text,
	"city" text,
	"company" text,
	"countryCode" text,
	"firstName" text,
	"lastName" text,
	"latitude" double precision,
	"longitude" double precision,
	"name" text,
	"phone" text,
	"provinceCode" text,
	"zip" text,
	"customerId" bigint,
	"orderId" bigint,
	"orderType" "ORDER_ADDRESS_TYPE",
	"organizationId" text NOT NULL,
	"integrationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AiIntegration" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"apiKey" text NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"status" "AiIntegrationStatus" DEFAULT 'PENDING' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"encryptedCredentials" jsonb,
	"loadBalancingEnabled" boolean DEFAULT false NOT NULL,
	"modelType" text DEFAULT 'llm' NOT NULL,
	"providerType" text DEFAULT 'custom' NOT NULL,
	"quotaLimit" integer DEFAULT '-1' NOT NULL,
	"quotaType" text,
	"quotaUsed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AiUsage" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"totalTokens" integer DEFAULT 0 NOT NULL,
	"cost" double precision,
	"organizationId" text NOT NULL,
	"userId" text,
	"endpoint" text,
	"inputTokens" integer DEFAULT 0 NOT NULL,
	"modelType" text DEFAULT 'llm' NOT NULL,
	"outputTokens" integer DEFAULT 0 NOT NULL,
	"requestId" text,
	"responseTime" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ApiKey" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text,
	"hashedKey" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workflowId" text NOT NULL,
	"workflowRunId" text NOT NULL,
	"nodeId" text NOT NULL,
	"nodeName" text NOT NULL,
	"status" "ApprovalStatus" DEFAULT 'pending' NOT NULL,
	"message" text,
	"assigneeUsers" text[],
	"assigneeGroups" text[],
	"workflowName" text NOT NULL,
	"createdById" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"expiresAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ApprovalResponse" (
	"id" text PRIMARY KEY NOT NULL,
	"approvalRequestId" text NOT NULL,
	"userId" text NOT NULL,
	"action" "ApprovalAction" NOT NULL,
	"respondedAt" timestamp (3) DEFAULT now() NOT NULL,
	"responseMethod" text NOT NULL,
	"ipAddress" text,
	"userAgent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ArticleRevision" (
	"id" text PRIMARY KEY NOT NULL,
	"articleId" text NOT NULL,
	"editorId" text,
	"organizationId" text NOT NULL,
	"previousContent" text NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"previousContentJson" jsonb,
	"wasCategory" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ArticleTag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Article" (
	"id" text PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"emoji" text,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"contentJson" jsonb,
	"excerpt" text,
	"isCategory" boolean DEFAULT false NOT NULL,
	"authorId" text,
	"status" "ArticleStatus" DEFAULT 'DRAFT' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"lastReviewedAt" timestamp (3),
	"viewsCount" integer DEFAULT 0 NOT NULL,
	"knowledgeBaseId" text NOT NULL,
	"organizationId" text NOT NULL,
	"parentId" text,
	"order" integer DEFAULT 0 NOT NULL,
	"isPublished" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp (3),
	"isHomePage" boolean DEFAULT false NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"role" text DEFAULT 'ATTACHMENT' NOT NULL,
	"title" text,
	"caption" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"fileId" text,
	"fileVersionId" text,
	"assetId" text,
	"assetVersionId" text,
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AutoResponseRule" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"conditions" jsonb NOT NULL,
	"responseType" "ResponseType" NOT NULL,
	"templateId" text,
	"aiPrompt" text,
	"requiresApproval" boolean DEFAULT true NOT NULL,
	"approverRoleIds" text[],
	"approverUserIds" text[],
	"delayMinutes" integer,
	"sendDuringBusinessHours" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"executionCount" integer DEFAULT 0 NOT NULL,
	"successCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ChatAttachment" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"filename" text NOT NULL,
	"contentType" text NOT NULL,
	"size" integer NOT NULL,
	"url" text NOT NULL,
	"sessionId" text NOT NULL,
	"messageId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ChatMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"content" text NOT NULL,
	"sender" text NOT NULL,
	"status" text DEFAULT 'SENT' NOT NULL,
	"sessionId" text NOT NULL,
	"agentId" text,
	"threadId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ChatSession" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"widgetId" text NOT NULL,
	"organizationId" text NOT NULL,
	"threadId" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"lastActivityAt" timestamp (3) DEFAULT now() NOT NULL,
	"closedAt" timestamp (3),
	"closedById" text,
	"visitorId" text NOT NULL,
	"visitorName" text,
	"visitorEmail" text,
	"userAgent" text,
	"ipAddress" text,
	"referrer" text,
	"url" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ChatWidget" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"integrationId" text,
	"name" text NOT NULL,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"title" text DEFAULT 'Chat Support' NOT NULL,
	"subtitle" text,
	"primaryColor" text DEFAULT '#4F46E5' NOT NULL,
	"logoUrl" text,
	"position" text DEFAULT 'BOTTOM_RIGHT' NOT NULL,
	"welcomeMessage" text,
	"autoOpen" boolean DEFAULT false NOT NULL,
	"mobileFullScreen" boolean DEFAULT true NOT NULL,
	"collectUserInfo" boolean DEFAULT false NOT NULL,
	"offlineMessage" text DEFAULT 'We''re currently offline. Please leave a message and we''ll get back to you as soon as possible.',
	"organizationId" text NOT NULL,
	"allowedDomains" text[],
	"useAi" boolean DEFAULT false NOT NULL,
	"aiModel" text,
	"aiInstructions" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CommentMention" (
	"id" text PRIMARY KEY NOT NULL,
	"commentId" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CommentReaction" (
	"id" text PRIMARY KEY NOT NULL,
	"commentId" text NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"emoji" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Comment" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"deletedAt" timestamp (3),
	"threadId" text,
	"ticketId" text,
	"entityId" text NOT NULL,
	"entityType" text NOT NULL,
	"createdById" text NOT NULL,
	"organizationId" text NOT NULL,
	"parentId" text,
	"isPinned" boolean DEFAULT false NOT NULL,
	"pinnedAt" timestamp (3),
	"pinnedById" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Contact" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"status" "CustomerStatus" DEFAULT 'ACTIVE' NOT NULL,
	"email" text,
	"emails" text[],
	"firstName" text,
	"lastName" text,
	"phone" text,
	"notes" text,
	"tags" text[],
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CustomExtractionRule" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entityType" text NOT NULL,
	"displayName" text NOT NULL,
	"ruleType" "ExtractionRuleType" NOT NULL,
	"pattern" text,
	"examples" text[],
	"contextBefore" text,
	"contextAfter" text,
	"htmlContext" text,
	"positionStart" integer,
	"positionEnd" integer,
	"selectionText" text,
	"selectionHtml" text,
	"domPath" text,
	"templateId" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"confidence" double precision DEFAULT 0.7 NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CustomFieldGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text NOT NULL,
	"fields" text[],
	"organizationId" text NOT NULL,
	"modelType" "DataModelType" DEFAULT 'CONTACT' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CustomFieldValue" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"entityId" text NOT NULL,
	"fieldId" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CustomField" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text NOT NULL,
	"type" "ContactFieldType" NOT NULL,
	"description" text,
	"required" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"defaultValue" text,
	"options" jsonb,
	"organizationId" text NOT NULL,
	"modelType" "DataModelType" DEFAULT 'CONTACT' NOT NULL,
	"icon" text,
	"isCustom" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CustomerGroupMember" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"customerGroupId" text NOT NULL,
	"contactId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CustomerGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CustomerSource" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"source" "CustomerSourceType" DEFAULT 'EMAIL' NOT NULL,
	"sourceId" text NOT NULL,
	"email" text,
	"sourceData" jsonb,
	"organizationId" text NOT NULL,
	"contactId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DatasetMetadata" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'string' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"datasetId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DatasetSearchQuery" (
	"id" text PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"queryType" text DEFAULT 'hybrid' NOT NULL,
	"resultsCount" integer DEFAULT 0 NOT NULL,
	"vectorSimilarityThreshold" double precision DEFAULT 0.7,
	"maxResults" integer DEFAULT 10 NOT NULL,
	"filters" jsonb,
	"responseTime" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"datasetId" text NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DatasetSearchResult" (
	"id" text PRIMARY KEY NOT NULL,
	"rank" integer NOT NULL,
	"score" double precision NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"queryId" text NOT NULL,
	"segmentId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Dataset" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "DatasetStatus" DEFAULT 'ACTIVE' NOT NULL,
	"isPublic" boolean DEFAULT false NOT NULL,
	"documentCount" integer DEFAULT 0 NOT NULL,
	"totalSize" bigint DEFAULT 0 NOT NULL,
	"lastIndexedAt" timestamp (3),
	"chunkSize" integer DEFAULT 1000 NOT NULL,
	"chunkOverlap" integer DEFAULT 200 NOT NULL,
	"chunkingStrategy" "ChunkingStrategy" DEFAULT 'FIXED_SIZE' NOT NULL,
	"vectorDbConfig" jsonb,
	"embeddingModel" text,
	"vectorDimension" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL,
	"vectorDbType" "VectorDbType" DEFAULT 'POSTGRESQL' NOT NULL,
	"embeddingModelProvider" text,
	"searchConfig" jsonb DEFAULT '{"searchType":"hybrid"}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DocumentSegment" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	"startOffset" integer NOT NULL,
	"endOffset" integer NOT NULL,
	"tokenCount" integer NOT NULL,
	"embedding" vector(1536),
	"embeddingModel" text,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"documentId" text NOT NULL,
	"organizationId" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"indexStatus" "IndexStatus" DEFAULT 'PENDING' NOT NULL,
	"searchMetadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Document" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"originalPath" text,
	"mimeType" text NOT NULL,
	"type" "DocumentType" NOT NULL,
	"size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"status" "DocumentStatus" DEFAULT 'UPLOADED' NOT NULL,
	"content" text,
	"processedAt" timestamp (3),
	"errorMessage" text,
	"processingTime" integer,
	"totalChunks" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"datasetId" text NOT NULL,
	"organizationId" text NOT NULL,
	"uploadedById" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"mediaAssetId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailAddress" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"address" text NOT NULL,
	"raw" text,
	"integrationId" text NOT NULL,
	"integrationType" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailAIAnalysis" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"organizationId" text NOT NULL,
	"categories" text[],
	"isSpam" boolean DEFAULT false NOT NULL,
	"spamConfidence" double precision DEFAULT 0 NOT NULL,
	"spamReason" text,
	"needsResponse" boolean DEFAULT false NOT NULL,
	"responseUrgency" integer,
	"suggestedResponseType" text,
	"orderNumbers" text[],
	"trackingNumbers" text[],
	"productIds" text[],
	"kbDocumentIds" text[],
	"entities" jsonb,
	"model" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailAttachment" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mimeType" text NOT NULL,
	"size" integer NOT NULL,
	"inline" boolean NOT NULL,
	"contentId" text,
	"content" text,
	"contentLocation" text,
	"messageId" text NOT NULL,
	"attachmentOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"mediaAssetId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailCategory" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"examplePhrases" text[],
	"keywordPatterns" text[],
	"autoLabel" boolean DEFAULT true NOT NULL,
	"autoAssignTo" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailContentAnalysis" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"summary" text,
	"urgency" integer,
	"topics" text[],
	"needsResponse" boolean DEFAULT false NOT NULL,
	"sentiment" text,
	"metadata" jsonb,
	"entities" jsonb,
	"intent" text,
	"analyzedAt" timestamp (3) DEFAULT now() NOT NULL,
	"automationConfidence" double precision,
	"complexityScore" text,
	"customerLifetimeValue" double precision,
	"customerTier" text,
	"frustrationLevel" double precision,
	"orderContext" jsonb,
	"retentionRisk" boolean DEFAULT false NOT NULL,
	"shopifyCustomerId" bigint,
	"shopifyEntities" jsonb,
	"shopifyIntent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailEmbedding" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailKBArticleReference" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"articleId" text NOT NULL,
	"isRecommended" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailOrderReference" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"orderNumber" text NOT NULL,
	"orderId" bigint,
	"exchangeEligible" boolean DEFAULT false NOT NULL,
	"fulfillmentStatus" text,
	"hasIssues" boolean DEFAULT false NOT NULL,
	"issueTypes" text[] DEFAULT '{"RAY"}',
	"orderStatus" text,
	"recommendedAction" text,
	"refundEligible" boolean DEFAULT false NOT NULL,
	"returnEligible" boolean DEFAULT false NOT NULL,
	"suggestedResponse" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailProcessingJob" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"status" "JobStatus" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastAttempt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"completedAt" timestamp (3),
	"error" text,
	"organizationId" text NOT NULL,
	"isSpam" boolean,
	"categoryIds" text[],
	"aiSummary" text,
	"sentiment" text,
	"matchedRuleCount" integer DEFAULT 0 NOT NULL,
	"executedActionCount" integer DEFAULT 0 NOT NULL,
	"isInternal" boolean,
	"senderType" "SenderType",
	"automationEligible" boolean DEFAULT false NOT NULL,
	"automationReason" text,
	"customerTier" text,
	"orderValue" double precision,
	"primaryOrderId" bigint,
	"riskFactors" text[] DEFAULT '{"RAY"}',
	"shopifyCustomerId" bigint,
	"shopifyIntent" text,
	"threadId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailProductReference" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"productId" bigint NOT NULL,
	"inventoryAvailable" boolean DEFAULT true NOT NULL,
	"issueCategory" text,
	"mentionType" text,
	"returnRate" double precision,
	"variantId" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailResponse" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"threadId" text NOT NULL,
	"organizationId" text NOT NULL,
	"subject" text,
	"htmlContent" text,
	"textContent" text,
	"toAddresses" text[],
	"ccAddresses" text[],
	"bccAddresses" text[],
	"responseType" "ResponseType" DEFAULT 'MANUAL' NOT NULL,
	"templateId" text,
	"generatedBy" text,
	"status" "ResponseStatus" DEFAULT 'DRAFT' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"sentAt" timestamp (3),
	"createdById" text,
	"deliveryStatus" "DeliveryStatus",
	"analysisId" text,
	"attachmentIds" text[],
	"metadata" jsonb,
	"customerReplied" boolean DEFAULT false NOT NULL,
	"customerTierUsed" text,
	"escalatedAfter" boolean DEFAULT false NOT NULL,
	"includesOrderData" boolean DEFAULT false NOT NULL,
	"includesTrackingInfo" boolean DEFAULT false NOT NULL,
	"personalizationData" jsonb,
	"satisfactionScore" double precision,
	"shopifyResponseType" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailRuleMatch" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"ruleId" text NOT NULL,
	"matchedAt" timestamp (3) DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmailTemplate" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "EmailTemplateType" NOT NULL,
	"subject" text NOT NULL,
	"bodyHtml" text NOT NULL,
	"bodyPlain" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embedding_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"status" text NOT NULL,
	"collection" text NOT NULL,
	"documents" jsonb NOT NULL,
	"chunkingOptions" jsonb,
	"documentCount" integer NOT NULL,
	"processedCount" integer DEFAULT 0 NOT NULL,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"error" text,
	"createdAt" timestamp (3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"completedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"jobId" text NOT NULL,
	"collection" text NOT NULL,
	"documentId" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"embedding" jsonb NOT NULL,
	"createdAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Event" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ExecutedRuleGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"messageId" text NOT NULL,
	"threadId" text NOT NULL,
	"matched" boolean NOT NULL,
	"score" double precision,
	"executionTime" integer NOT NULL,
	"ruleResults" jsonb NOT NULL,
	"metadata" jsonb,
	"executedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ExecutedRule" (
	"id" text PRIMARY KEY NOT NULL,
	"ruleId" text NOT NULL,
	"messageId" text NOT NULL,
	"threadId" text NOT NULL,
	"executedAt" timestamp (3) DEFAULT now() NOT NULL,
	"successful" boolean DEFAULT true NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ExternalKnowledgeSource" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sourceType" text NOT NULL,
	"endpoint" text,
	"configuration" jsonb NOT NULL,
	"syncEnabled" boolean DEFAULT false NOT NULL,
	"syncInterval" integer,
	"lastSyncAt" timestamp (3),
	"nextSyncAt" timestamp (3),
	"status" text DEFAULT 'inactive' NOT NULL,
	"errorMessage" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"datasetId" text NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ExtractionTemplate" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sampleText" text,
	"sampleHtml" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "FileAttachment" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"fileId" text NOT NULL,
	"attachableId" text NOT NULL,
	"attachableType" text NOT NULL,
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "FileVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"fileId" text NOT NULL,
	"versionNumber" integer NOT NULL,
	"size" bigint,
	"checksum" text,
	"mimeType" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"storageLocationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "File" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text,
	"hashedKey" text NOT NULL,
	"createdById" text,
	"organizationId" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"type" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deletedAt" timestamp (3),
	"deletedById" text,
	"entityId" text,
	"entityType" text,
	"articleId" text,
	"knowledgeBaseId" text,
	"checksum" text,
	"confirmedAt" timestamp (3),
	"downloadCount" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp (3),
	"lastAccessedAt" timestamp (3),
	"status" "FileStatus" DEFAULT 'PENDING' NOT NULL,
	"visibility" "FileVisibility" DEFAULT 'PRIVATE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "FolderFile" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"folderId" text,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"ext" text,
	"mimeType" text,
	"size" bigint,
	"checksum" text,
	"currentVersionId" text,
	"isArchived" boolean DEFAULT false NOT NULL,
	"deletedAt" timestamp (3),
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"provider" "StorageProvider"
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Folder" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"parentId" text,
	"path" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"deletedAt" timestamp (3),
	"isArchived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "FulfillmentTracking" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"number" text NOT NULL,
	"url" text,
	"company" text NOT NULL,
	"orderId" bigint NOT NULL,
	"fulfillmentId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "GroupMember" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"userId" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"joinedAt" timestamp (3) DEFAULT now() NOT NULL,
	"deactivatedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Group" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"properties" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "InboxGroupAccess" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"inboxId" text NOT NULL,
	"groupId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "InboxIntegration" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"isDefault" boolean DEFAULT false NOT NULL,
	"inboxId" text NOT NULL,
	"integrationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "InboxMemberAccess" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"inboxId" text NOT NULL,
	"organizationMemberId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#4F46E5',
	"status" "InboxStatus" DEFAULT 'ACTIVE' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"allowAllMembers" boolean DEFAULT true NOT NULL,
	"enableMemberAccess" boolean DEFAULT false NOT NULL,
	"enableGroupAccess" boolean DEFAULT false NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "MediaAsset" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"mimeType" text,
	"size" bigint,
	"isPrivate" boolean DEFAULT true NOT NULL,
	"deletedAt" timestamp (3),
	"currentVersionId" text,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"expiresAt" timestamp (3),
	"purpose" text DEFAULT 'ORIGINAL' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "MediaAssetVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"assetId" text NOT NULL,
	"versionNumber" integer NOT NULL,
	"size" bigint,
	"mimeType" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"storageLocationId" text,
	"deletedAt" timestamp (3),
	"derivedFromVersionId" text,
	"preset" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"status" "AssetVersionStatus" DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Organization" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text,
	"website" text,
	"about" text,
	"email_domain" text,
	"type" "OrganizationType" DEFAULT 'TEAM' NOT NULL,
	"createdById" text NOT NULL,
	"systemUserId" text,
	"handle" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OrganizationMember" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"status" "OrganizationMemberStatus" DEFAULT 'ACTIVE' NOT NULL,
	"role" "OrganizationRole" DEFAULT 'USER' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OrganizationInvitation" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"email" text NOT NULL,
	"role" "OrganizationRole" NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"status" "InvitationStatus" DEFAULT 'PENDING' NOT NULL,
	"organizationId" text NOT NULL,
	"invitedById" text NOT NULL,
	"acceptedById" text,
	"acceptedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OrganizationSetting" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"allowUserOverride" boolean DEFAULT false NOT NULL,
	"scope" "SettingScope" DEFAULT 'GENERAL' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "UserSetting" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"organizationSettingId" text NOT NULL,
	"value" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "IntegrationSchedule" (
	"id" text PRIMARY KEY NOT NULL,
	"integrationId" text NOT NULL,
	"workingHours" jsonb,
	"outOfOffice" boolean DEFAULT false NOT NULL,
	"outOfOfficeStart" timestamp (3),
	"outOfOfficeEnd" timestamp (3),
	"outOfOfficeMessage" text,
	"timeZone" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ShopifyIntegration" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"shopDomain" text NOT NULL,
	"accessToken" text NOT NULL,
	"scope" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ShopifyAuthState" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"state" text NOT NULL,
	"shopDomain" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Participant" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"identifierType" "IdentifierType" NOT NULL,
	"name" text,
	"displayName" text,
	"initials" text,
	"isSpammer" boolean DEFAULT false NOT NULL,
	"contactId" text,
	"organizationId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"firstInteractionDate" timestamp (3),
	"firstInteractionType" text,
	"hasReceivedMessage" boolean DEFAULT false NOT NULL,
	"lastSentMessageAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "VerificationToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ThreadReadStatus" (
	"id" text PRIMARY KEY NOT NULL,
	"threadId" text NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL,
	"lastReadAt" timestamp (3),
	"lastSeenMessageId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "UserInboxUnreadCount" (
	"id" text PRIMARY KEY NOT NULL,
	"inboxId" text NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"unreadCount" integer DEFAULT 0 NOT NULL,
	"lastUpdatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Label" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"integrationType" text NOT NULL,
	"integrationId" text NOT NULL,
	"labelId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"isVisible" boolean DEFAULT true NOT NULL,
	"backgroundColor" text,
	"textColor" text,
	"type" "LabelType" NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Signature" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL,
	"sharingType" "SignatureSharingType" DEFAULT 'PRIVATE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Message" (
	"id" text PRIMARY KEY NOT NULL,
	"externalId" text,
	"externalThreadId" text,
	"threadId" text NOT NULL,
	"integrationId" text NOT NULL,
	"integrationType" text NOT NULL,
	"messageType" "MessageType" DEFAULT 'EMAIL' NOT NULL,
	"isInbound" boolean DEFAULT true NOT NULL,
	"isAutoReply" boolean DEFAULT false NOT NULL,
	"isFirstInThread" boolean DEFAULT true NOT NULL,
	"isAIGenerated" boolean DEFAULT false NOT NULL,
	"draftMode" "DraftMode" DEFAULT 'NONE' NOT NULL,
	"subject" text NOT NULL,
	"textHtml" text,
	"textPlain" text,
	"internetMessageId" text,
	"snippet" text,
	"metadata" jsonb,
	"createdById" text,
	"organizationId" text NOT NULL,
	"fromId" text NOT NULL,
	"replyToId" text,
	"isReply" boolean DEFAULT false NOT NULL,
	"historyId" bigint,
	"createdTime" timestamp (3) NOT NULL,
	"lastModifiedTime" timestamp (3) NOT NULL,
	"sentAt" timestamp (3),
	"receivedAt" timestamp (3),
	"keywords" text[],
	"signatureId" text,
	"hasAttachments" boolean DEFAULT false NOT NULL,
	"inReplyTo" text,
	"references" text,
	"threadIndex" text,
	"internetHeaders" jsonb[],
	"folderId" text,
	"emailLabel" "EmailLabel" DEFAULT 'inbox' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastAttemptAt" timestamp (3),
	"providerError" text,
	"sendStatus" "SendStatus" DEFAULT 'SENT',
	"sendToken" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "MessageParticipant" (
	"id" text PRIMARY KEY NOT NULL,
	"role" "ParticipantRole" NOT NULL,
	"messageId" text NOT NULL,
	"participantId" text NOT NULL,
	"contactId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Order" (
	"id" bigint PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"cancelledAt" timestamp (3),
	"closedAt" timestamp (3),
	"processedAt" timestamp (3),
	"cancelReason" "ORDER_CANCEL_REASON",
	"canNotifyCustomer" boolean DEFAULT false NOT NULL,
	"confirmationNumber" text,
	"currencyCode" text DEFAULT 'USD' NOT NULL,
	"discountCode" text,
	"financialStatus" "ORDER_FINANCIAL_STATUS" NOT NULL,
	"fulfillmentStatus" "ORDER_FULFILLMENT_STATUS" NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"note" text,
	"phone" text,
	"poNumber" text,
	"returnStatus" "ORDER_RETURN_STATUS",
	"tags" text[],
	"taxExempt" boolean DEFAULT false NOT NULL,
	"subtotalPrice" integer DEFAULT 0 NOT NULL,
	"totalDiscounts" integer DEFAULT 0 NOT NULL,
	"totalPrice" integer DEFAULT 0 NOT NULL,
	"totalRefunded" integer DEFAULT 0 NOT NULL,
	"totalShippingPrice" integer DEFAULT 0 NOT NULL,
	"totalTax" integer DEFAULT 0 NOT NULL,
	"shippingAddressId" bigint,
	"billingAddressId" bigint,
	"customerId" bigint NOT NULL,
	"organizationId" text NOT NULL,
	"integrationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Thread" (
	"id" text PRIMARY KEY NOT NULL,
	"externalId" text,
	"subject" text NOT NULL,
	"participantIds" text[],
	"organizationId" text NOT NULL,
	"integrationId" text NOT NULL,
	"integrationType" "IntegrationType" NOT NULL,
	"assigneeId" text,
	"messageType" "MessageType" NOT NULL,
	"type" "ThreadType" DEFAULT 'EMAIL' NOT NULL,
	"status" "ThreadStatus" DEFAULT 'OPEN' NOT NULL,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"participantCount" integer DEFAULT 0 NOT NULL,
	"firstMessageAt" timestamp (3),
	"lastMessageAt" timestamp (3),
	"closedAt" timestamp (3),
	"repliedAt" timestamp (3),
	"waitingSince" timestamp (3),
	"inboxId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Product" (
	"id" bigint PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"publishedAt" timestamp (3),
	"title" text NOT NULL,
	"descriptionHtml" text,
	"vendor" text,
	"hasOnlyDefaultVariant" boolean NOT NULL,
	"productType" text,
	"handle" text NOT NULL,
	"status" "PRODUDT_STATUS" DEFAULT 'DRAFT' NOT NULL,
	"tags" text[],
	"tracksInventory" boolean NOT NULL,
	"totalInventory" integer NOT NULL,
	"integrationId" text NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text,
	"refreshToken" text,
	"accessToken" text,
	"expiresAt" timestamp (3),
	"enabled" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"routingEnabled" boolean DEFAULT false NOT NULL,
	"routingId" text,
	"routingDomain" text,
	"destinationEmail" text,
	"lastSyncedAt" timestamp (3),
	"refreshTokenExpiresIn" integer,
	"email" text,
	"customerId" text,
	"lastHistoryId" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"messageType" "MessageType" DEFAULT 'EMAIL' NOT NULL,
	"authStatus" "IntegrationAuthStatus" DEFAULT 'AUTHENTICATED' NOT NULL,
	"lastAuthError" text,
	"lastAuthErrorAt" timestamp (3),
	"lastSuccessfulSync" timestamp (3),
	"requiresReauth" boolean DEFAULT false NOT NULL,
	"provider" "IntegrationProviderType" DEFAULT 'google' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ResponseTemplate" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"subject" text,
	"htmlContent" text NOT NULL,
	"textContent" text NOT NULL,
	"category" text,
	"tags" text[],
	"isActive" boolean DEFAULT true NOT NULL,
	"applicableFor" jsonb,
	"usageCount" integer DEFAULT 0 NOT NULL,
	"lastUsed" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"createdById" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ThreadAnalysis" (
	"id" text PRIMARY KEY NOT NULL,
	"threadId" text NOT NULL,
	"organizationId" text NOT NULL,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"participantCount" integer DEFAULT 0 NOT NULL,
	"firstMessageAt" timestamp (3),
	"lastMessageAt" timestamp (3),
	"internalMessages" integer DEFAULT 0 NOT NULL,
	"externalMessages" integer DEFAULT 0 NOT NULL,
	"unansweredCount" integer DEFAULT 0 NOT NULL,
	"averageResponseTime" integer,
	"topCategories" text[],
	"status" "ThreadStatus" DEFAULT 'ACTIVE' NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ThreadParticipant" (
	"id" text PRIMARY KEY NOT NULL,
	"threadId" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"isInternal" boolean DEFAULT false NOT NULL,
	"messageCount" integer DEFAULT 1 NOT NULL,
	"firstMessageAt" timestamp (3) NOT NULL,
	"lastMessageAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ThreadTracker" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"sentAt" timestamp (3) NOT NULL,
	"threadId" text NOT NULL,
	"messageId" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"type" "ThreadTrackerType" NOT NULL,
	"ruleId" text,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ProductVariant" (
	"id" bigint PRIMARY KEY NOT NULL,
	"availableForSale" boolean NOT NULL,
	"barcode" text,
	"createdAt" timestamp (3),
	"updatedAt" timestamp (3),
	"displayName" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"compareAtPrice" integer,
	"sku" text,
	"taxable" boolean DEFAULT true NOT NULL,
	"title" text NOT NULL,
	"selectedOptions" jsonb[],
	"imageId" bigint,
	"imageUrl" text,
	"inventoryItemId" bigint,
	"inventoryManagement" text,
	"inventoryPolicy" "INVENTORY_POLICY" DEFAULT 'CONTINUE' NOT NULL,
	"inventoryQuantity" integer,
	"weightUnit" text,
	"weight" integer,
	"productId" bigint NOT NULL,
	"organizationId" text NOT NULL,
	"integrationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ProductMedia" (
	"id" bigint PRIMARY KEY NOT NULL,
	"alt" text,
	"mediaContentType" "MEDIA_CONTENT_TYPE" DEFAULT 'IMAGE' NOT NULL,
	"previewId" bigint NOT NULL,
	"previewAlt" text,
	"previewHeight" integer,
	"previewWidth" integer,
	"previewUrl" text,
	"width" integer,
	"height" integer,
	"createdAt" timestamp (3),
	"updatedAt" timestamp (3),
	"variantIds" text[],
	"productId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ProductOption" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer,
	"values" text[],
	"productId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopify_customers" (
	"id" bigint PRIMARY KEY NOT NULL,
	"firstName" text,
	"lastName" text,
	"email" text,
	"phone" text,
	"createdAt" timestamp (3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"numberOfOrders" integer,
	"state" text,
	"amountSpent" integer,
	"note" text,
	"verifiedEmail" boolean,
	"multipassIdentifier" text,
	"taxExempt" boolean,
	"tags" text[],
	"defaultAddressId" bigint,
	"lastOrderId" bigint,
	"lastOrderName" text,
	"organizationId" text NOT NULL,
	"integrationId" text NOT NULL,
	"contactId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OrderRefund" (
	"id" bigint PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"totalRefundedAmount" integer NOT NULL,
	"currencyCode" text NOT NULL,
	"orderId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OrderReturn" (
	"id" bigint PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"status" "RETURN_STATUS" NOT NULL,
	"orderId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OrderLineItem" (
	"id" bigint PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"productId" bigint,
	"variantId" bigint,
	"title" text NOT NULL,
	"originalTotal" integer DEFAULT 0 NOT NULL,
	"originalUnitPrice" integer DEFAULT 0 NOT NULL,
	"orderId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OrderFulfillment" (
	"id" bigint PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"deliveredAt" timestamp (3),
	"status" "FULFILLMENT_STATUS" DEFAULT 'OPEN' NOT NULL,
	"requiresShipping" boolean DEFAULT true NOT NULL,
	"orderId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"provider" text NOT NULL,
	"providerId" text NOT NULL,
	"topic" text NOT NULL,
	"format" text NOT NULL,
	"secret" text,
	"active" boolean DEFAULT true NOT NULL,
	"organizationId" text NOT NULL,
	"integrationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WebhookEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"retryCount" integer DEFAULT 0 NOT NULL,
	"payload" text NOT NULL,
	"headers" text,
	"subscriptionId" text NOT NULL,
	"integrationId" text NOT NULL,
	"organizationId" text NOT NULL,
	"topic" text NOT NULL,
	"eventId" text NOT NULL,
	"status" "SYNC_STATUS" DEFAULT 'PENDING' NOT NULL,
	"startTime" timestamp (3),
	"endTime" timestamp (3),
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"eventTypes" text[],
	"lastTriggeredAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
	"id" text PRIMARY KEY NOT NULL,
	"webhookId" text NOT NULL,
	"eventType" text NOT NULL,
	"status" text NOT NULL,
	"responseStatus" integer NOT NULL,
	"responseBody" text,
	"errorMessage" text,
	"attemptCount" integer DEFAULT 1 NOT NULL,
	"nextRetryAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PromptHistory" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"prompt" text NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Part" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sku" text NOT NULL,
	"hsCode" text,
	"category" text,
	"shopifyProductLinkId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"cost" integer,
	"createdById" text,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Subpart" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"parentPartId" text NOT NULL,
	"childPartId" text NOT NULL,
	"quantity" integer NOT NULL,
	"notes" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Vendor" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contactName" text,
	"email" text,
	"phone" text,
	"address" text,
	"website" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "VendorPart" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"partId" text NOT NULL,
	"vendorId" text NOT NULL,
	"vendorSku" text NOT NULL,
	"unitPrice" integer,
	"leadTime" integer,
	"minOrderQty" integer,
	"isPreferred" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"partId" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"location" text,
	"reorderPoint" integer,
	"reorderQty" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TicketSequence" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"currentNumber" integer DEFAULT 0 NOT NULL,
	"prefix" text,
	"paddingLength" integer DEFAULT 4 NOT NULL,
	"usePrefix" boolean DEFAULT true NOT NULL,
	"useDateInPrefix" boolean DEFAULT false NOT NULL,
	"dateFormat" text DEFAULT 'YYMM',
	"separator" text DEFAULT '-' NOT NULL,
	"suffix" text,
	"useSuffix" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TicketReply" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"messageId" text,
	"senderEmail" text,
	"isFromCustomer" boolean DEFAULT false NOT NULL,
	"ticketId" text NOT NULL,
	"recipientEmail" text,
	"ccEmails" text[] DEFAULT '{"RAY"}',
	"createdById" text,
	"mailgunMessageId" text,
	"inReplyTo" text,
	"references" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TicketRelation" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"relatedTicketId" text NOT NULL,
	"relation" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" "TicketType" NOT NULL,
	"priority" "TicketPriority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "TicketStatus" DEFAULT 'OPEN' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"dueDate" timestamp (3),
	"resolvedAt" timestamp (3),
	"closedAt" timestamp (3),
	"organizationId" text NOT NULL,
	"emailThreadId" text,
	"createdById" text,
	"parentTicketId" text,
	"orderId" bigint,
	"mailgunMessageId" text,
	"internalReference" text,
	"contactId" text NOT NULL,
	"shopifyCustomerId" bigint,
	"typeData" jsonb DEFAULT '{}'::jsonb,
	"typeStatus" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"isPublic" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL,
	"customDomain" text,
	"logoDark" text,
	"logoLight" text,
	"theme" text DEFAULT 'clean',
	"showMode" boolean DEFAULT true NOT NULL,
	"defaultMode" text DEFAULT 'light',
	"primaryColorLight" text,
	"primaryColorDark" text,
	"tintColorLight" text,
	"tintColorDark" text,
	"infoColorLight" text,
	"infoColorDark" text,
	"successColorLight" text,
	"successColorDark" text,
	"warningColorLight" text,
	"warningColorDark" text,
	"dangerColorLight" text,
	"dangerColorDark" text,
	"fontFamily" text,
	"iconsFamily" text DEFAULT 'Regular',
	"cornerStyle" text DEFAULT 'Rounded',
	"sidebarListStyle" text DEFAULT 'Default',
	"searchbarPosition" text DEFAULT 'center',
	"headerNavigation" jsonb,
	"footerNavigation" jsonb,
	"logoDarkId" text,
	"logoLightId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TicketView" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"isPublic" boolean DEFAULT false NOT NULL,
	"filters" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TicketNote" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"content" text NOT NULL,
	"authorId" text,
	"isInternal" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TicketAssignment" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"agentId" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"assignedAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "User" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"lastActiveAt" timestamp (3),
	"completedOnboarding" boolean DEFAULT false,
	"twoFactorEnabled" boolean DEFAULT false,
	"hashedPassword" text,
	"watchEmailsExpirationDate" timestamp (3),
	"image" text,
	"about" text,
	"isSuperAdmin" boolean DEFAULT false NOT NULL,
	"defaultOrganizationId" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhookSecret" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"phoneNumber" text,
	"phoneNumberVerified" boolean DEFAULT false,
	"updatedAt" timestamp (3) NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"avatarAssetId" text,
	"userType" "UserType" DEFAULT 'USER' NOT NULL,
	"firstName" text,
	"lastName" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "MailDomain" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"domain" text NOT NULL,
	"subdomain" text,
	"type" "DomainType" DEFAULT 'CUSTOM' NOT NULL,
	"routingPrefix" text DEFAULT 'ticket' NOT NULL,
	"isVerified" boolean DEFAULT false NOT NULL,
	"verificationToken" text NOT NULL,
	"verifiedAt" timestamp (3),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"webhookKey" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SnippetFolder" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"parentId" text,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Snippet" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"contentHtml" text,
	"description" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"isDeleted" boolean DEFAULT false NOT NULL,
	"folderId" text,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL,
	"sharingType" "SnippetSharingType" DEFAULT 'PRIVATE' NOT NULL,
	"isFavorite" boolean DEFAULT false NOT NULL,
	"usageCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SnippetShare" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"snippetId" text NOT NULL,
	"groupId" text,
	"memberId" text,
	"permission" "SnippetPermission" DEFAULT 'VIEW' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SignatureIntegrationShare" (
	"id" text PRIMARY KEY NOT NULL,
	"signatureId" text NOT NULL,
	"integrationId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "MailView" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isPinned" boolean DEFAULT false NOT NULL,
	"isShared" boolean DEFAULT false NOT NULL,
	"filters" jsonb NOT NULL,
	"sortField" text,
	"sortDirection" text DEFAULT 'desc',
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "OperatingHours" (
	"id" text PRIMARY KEY NOT NULL,
	"widgetId" text NOT NULL,
	"dayOfWeek" integer NOT NULL,
	"startHour" integer NOT NULL,
	"startMinute" integer NOT NULL,
	"endHour" integer NOT NULL,
	"endMinute" integer NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PlanSubscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"planId" text NOT NULL,
	"status" "SubscriptionStatus" DEFAULT 'ACTIVE' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"billingCycle" "BillingCycle" DEFAULT 'MONTHLY' NOT NULL,
	"startDate" timestamp (3) DEFAULT now() NOT NULL,
	"endDate" timestamp (3),
	"canceledAt" timestamp (3),
	"stripeCustomerId" text,
	"stripeSubscriptionId" text,
	"currentPeriodStart" timestamp (3) DEFAULT now(),
	"currentPeriodEnd" timestamp (3),
	"creditsBalance" integer DEFAULT 0 NOT NULL,
	"paymentMethodId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"trialStart" timestamp (3),
	"trialEnd" timestamp (3),
	"hasTrialEnded" boolean DEFAULT false NOT NULL,
	"trialConversionStatus" "TrialConversionStatus",
	"isEligibleForTrial" boolean DEFAULT true NOT NULL,
	"trialEligibilityReason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"monthlyPrice" integer NOT NULL,
	"annualPrice" integer NOT NULL,
	"isCustomPricing" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"trialDays" integer DEFAULT 14 NOT NULL,
	"hasTrial" boolean DEFAULT false NOT NULL,
	"minSeats" integer DEFAULT 1 NOT NULL,
	"maxSeats" integer DEFAULT 10 NOT NULL,
	"isLegacy" boolean DEFAULT false NOT NULL,
	"selfServed" boolean DEFAULT false NOT NULL,
	"isMostPopular" boolean DEFAULT false NOT NULL,
	"isFree" boolean DEFAULT false NOT NULL,
	"featureLimits" jsonb DEFAULT '[]'::jsonb,
	"stripeProductId" text,
	"stripePriceIdMonthly" text,
	"stripePriceIdAnnual" text,
	"hierarchyLevel" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PaymentMethod" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"type" text NOT NULL,
	"brand" text,
	"last4" text,
	"expMonth" integer,
	"expYear" integer,
	"isDefault" boolean DEFAULT false NOT NULL,
	"stripePaymentMethodId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"subscriptionId" text NOT NULL,
	"invoiceNumber" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "InvoiceStatus" DEFAULT 'PENDING' NOT NULL,
	"invoiceDate" timestamp (3) DEFAULT now() NOT NULL,
	"dueDate" timestamp (3) NOT NULL,
	"paidDate" timestamp (3),
	"currency" text,
	"billingReason" text,
	"stripeInvoiceId" text,
	"pdfUrl" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Tag" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"emoji" text,
	"color" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"parentId" text,
	"organizationId" text NOT NULL,
	"isSystemTag" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Notification" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "NotificationType" NOT NULL,
	"message" text NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"readAt" timestamp (3),
	"userId" text NOT NULL,
	"entityId" text NOT NULL,
	"entityType" text NOT NULL,
	"actorId" text,
	"organizationId" text NOT NULL,
	"deliveredAt" timestamp (3),
	"deliveryMethod" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean DEFAULT false NOT NULL,
	"transports" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"ipAddress" text,
	"userAgent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TwoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"secret" text,
	"backupCodes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SyncJob" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" "SYNC_STATUS" DEFAULT 'PENDING' NOT NULL,
	"startTime" timestamp (3) DEFAULT now() NOT NULL,
	"endTime" timestamp (3),
	"error" text,
	"totalRecords" integer DEFAULT 0 NOT NULL,
	"processedRecords" integer DEFAULT 0 NOT NULL,
	"organizationId" text NOT NULL,
	"integrationId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"failedRecords" integer DEFAULT 0 NOT NULL,
	"integrationCategory" text DEFAULT 'message' NOT NULL,
	"integrationSyncJobIds" text[] DEFAULT '{"RAY"}'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TableView" (
	"id" text PRIMARY KEY NOT NULL,
	"tableId" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isShared" boolean DEFAULT false NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "RuleGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"actions" jsonb,
	"createdById" text,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"name" text NOT NULL,
	"operator" "RuleGroupOperator" DEFAULT 'AND' NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"threshold" double precision
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "RuleGroupRule" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"ruleId" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "RuleGroupRelation" (
	"id" text PRIMARY KEY NOT NULL,
	"parentId" text NOT NULL,
	"childId" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TestCase" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"email" jsonb NOT NULL,
	"expectedRules" jsonb NOT NULL,
	"expectedActions" jsonb NOT NULL,
	"tags" text[],
	"version" integer DEFAULT 1 NOT NULL,
	"status" "TestCaseStatus" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TestSuite" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TestCaseInSuite" (
	"id" text PRIMARY KEY NOT NULL,
	"suiteId" text NOT NULL,
	"testCaseId" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "RuleInSuite" (
	"id" text PRIMARY KEY NOT NULL,
	"suiteId" text NOT NULL,
	"ruleId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TestRun" (
	"id" text PRIMARY KEY NOT NULL,
	"suiteId" text,
	"status" "TestRunStatus" DEFAULT 'PENDING' NOT NULL,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3),
	"results" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"executedById" text NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TestResult" (
	"id" text PRIMARY KEY NOT NULL,
	"runId" text NOT NULL,
	"testCaseId" text NOT NULL,
	"passed" boolean NOT NULL,
	"actualRules" jsonb NOT NULL,
	"actualActions" jsonb NOT NULL,
	"errorMessage" text,
	"executionTime" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "RuleAction" (
	"id" text PRIMARY KEY NOT NULL,
	"ruleId" text NOT NULL,
	"actionType" "ActionType" NOT NULL,
	"parameters" jsonb NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "RuleType" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb,
	"actions" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"instructions" text,
	"categoryFilterType" text,
	"matchCount" integer DEFAULT 0 NOT NULL,
	"lastMatchedAt" timestamp (3),
	"applyToInternal" boolean,
	"categoryIds" text[],
	"ruleGroupId" text,
	"senderTypes" text[],
	"spamConfidenceThreshold" double precision,
	"staticRuleType" "StaticRuleType",
	"requiresManualApproval" boolean DEFAULT false NOT NULL,
	"workflowNodeId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ProposedAction" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"messageId" text NOT NULL,
	"ruleId" text NOT NULL,
	"actionParams" jsonb NOT NULL,
	"modifiedParams" jsonb,
	"status" "ProposedActionStatus" DEFAULT 'PENDING' NOT NULL,
	"approvedById" text,
	"rejectedById" text,
	"approvedAt" timestamp (3),
	"executedAt" timestamp (3),
	"executionError" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"confidence" double precision,
	"executionMetadata" jsonb,
	"executionResult" jsonb,
	"explanation" text,
	"actionType" "ActionType" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ShopifyAutomationMetrics" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"totalShopifyEmails" integer DEFAULT 0 NOT NULL,
	"automatedResponses" integer DEFAULT 0 NOT NULL,
	"manualEscalations" integer DEFAULT 0 NOT NULL,
	"orderStatusQueries" integer DEFAULT 0 NOT NULL,
	"orderStatusAutomated" integer DEFAULT 0 NOT NULL,
	"returnRequests" integer DEFAULT 0 NOT NULL,
	"returnAutomated" integer DEFAULT 0 NOT NULL,
	"avgConfidenceScore" double precision,
	"customerReplyRate" double precision,
	"escalationRate" double precision,
	"avgResponseTime" integer,
	"costSavingsEstimate" double precision,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ShopifyAutomationRule" (
	"id" text PRIMARY KEY NOT NULL,
	"intentTypes" text[],
	"customerTiers" text[],
	"minConfidence" double precision,
	"responseTemplate" text NOT NULL,
	"includeOrderData" boolean DEFAULT true NOT NULL,
	"includeTracking" boolean DEFAULT true NOT NULL,
	"maxOrderAge" integer,
	"maxRefundAmount" double precision,
	"successRate" double precision,
	"aiInstructions" text,
	"allowAutomaticRefunds" boolean DEFAULT false NOT NULL,
	"autoReplyForCommonQueries" boolean DEFAULT true NOT NULL,
	"enableCustomerLookup" boolean DEFAULT true NOT NULL,
	"enableInventoryCheck" boolean DEFAULT false NOT NULL,
	"enableOrderLookup" boolean DEFAULT true NOT NULL,
	"escalateComplexIssues" boolean DEFAULT true NOT NULL,
	"maxAutoReplyAttempts" integer DEFAULT 3 NOT NULL,
	"requireManagerApproval" boolean DEFAULT true NOT NULL,
	"ruleId" text NOT NULL,
	"useAdvancedAI" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "IntegrationTagLabel" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"tagId" text NOT NULL,
	"labelId" text NOT NULL,
	"integrationId" text NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SearchHistory" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"query" text NOT NULL,
	"searchedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "LoadBalancingConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"modelType" text NOT NULL,
	"name" text NOT NULL,
	"credentials" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ProviderPreference" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"provider" text NOT NULL,
	"preferredType" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ModelConfiguration" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"model" text NOT NULL,
	"modelType" text DEFAULT 'llm' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"credentials" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"triggerType" text,
	"triggerConfig" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"createdById" text,
	"env_vars" jsonb,
	"graph" jsonb,
	"workflowAppId" text NOT NULL,
	"variables" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WorkflowApp" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdById" text,
	"isPublic" boolean DEFAULT false NOT NULL,
	"isUniversal" boolean DEFAULT false NOT NULL,
	"workflowId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"draftWorkflowId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ProviderConfiguration" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"provider" text NOT NULL,
	"providerType" text NOT NULL,
	"credentials" jsonb,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"quotaType" text,
	"quotaLimit" integer DEFAULT '-1' NOT NULL,
	"quotaPeriodEnd" timestamp (3),
	"quotaPeriodStart" timestamp (3),
	"quotaUsed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WorkflowRun" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workflowAppId" text NOT NULL,
	"sequenceNumber" integer NOT NULL,
	"workflowId" text NOT NULL,
	"type" text NOT NULL,
	"triggeredFrom" "WorkflowTriggerSource" NOT NULL,
	"version" text NOT NULL,
	"graph" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb,
	"status" "WorkflowRunStatus" NOT NULL,
	"error" text,
	"elapsedTime" double precision,
	"totalTokens" integer DEFAULT 0 NOT NULL,
	"totalSteps" integer DEFAULT 0 NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"finishedAt" timestamp (3),
	"pausedAt" timestamp (3),
	"pausedNodeId" text,
	"resumeAt" timestamp (3),
	"serializedState" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WorkflowNodeExecution" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workflowAppId" text NOT NULL,
	"workflowId" text NOT NULL,
	"triggeredFrom" "NodeTriggerSource" NOT NULL,
	"workflowRunId" text,
	"index" integer NOT NULL,
	"predecessorNodeId" text,
	"nodeId" text NOT NULL,
	"nodeType" text NOT NULL,
	"title" text NOT NULL,
	"inputs" jsonb,
	"processData" jsonb,
	"outputs" jsonb,
	"status" "NodeExecutionStatus" NOT NULL,
	"error" text,
	"elapsedTime" double precision,
	"executionMetadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"finishedAt" timestamp (3),
	"createdById" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WorkflowJoinState" (
	"id" text PRIMARY KEY NOT NULL,
	"executionId" text NOT NULL,
	"joinNodeId" text NOT NULL,
	"forkNodeId" text NOT NULL,
	"expectedInputs" jsonb NOT NULL,
	"completedInputs" jsonb NOT NULL,
	"branchResults" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"workflowId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WorkflowFile" (
	"id" text PRIMARY KEY NOT NULL,
	"workflowId" text NOT NULL,
	"fileId" text NOT NULL,
	"nodeId" text NOT NULL,
	"uploadedAt" timestamp (3) DEFAULT now() NOT NULL,
	"uploadSource" text DEFAULT 'local' NOT NULL,
	"originalUrl" text,
	"expiresAt" timestamp (3),
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "WorkflowCredentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"encryptedData" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "StorageLocation" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "StorageProvider" NOT NULL,
	"externalId" text NOT NULL,
	"externalUrl" text NOT NULL,
	"externalRev" text NOT NULL,
	"credentialId" text,
	"size" bigint DEFAULT 0,
	"mimeType" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "UploadSession" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"provider" "StorageProvider" DEFAULT 'S3' NOT NULL,
	"externalId" text,
	"credentialId" text,
	"fileName" text NOT NULL,
	"mimeType" text,
	"expectedSize" bigint,
	"checksum" text,
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3),
	"canceledAt" timestamp (3),
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "LabelsOnThread" (
	"threadId" text NOT NULL,
	"labelId" text NOT NULL,
	CONSTRAINT "LabelsOnThread_pkey" PRIMARY KEY("threadId","labelId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TagsOnArticle" (
	"articleId" text NOT NULL,
	"tagId" text NOT NULL,
	CONSTRAINT "TagsOnArticle_pkey" PRIMARY KEY("articleId","tagId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TagsOnThread" (
	"tagId" text NOT NULL,
	"threadId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdBy" text,
	CONSTRAINT "TagsOnThread_pkey" PRIMARY KEY("tagId","threadId")
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "account" ADD CONSTRAINT "account_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_shopify_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."shopify_customers"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Address" ADD CONSTRAINT "Address_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Address" ADD CONSTRAINT "Address_integrationId_ShopifyIntegration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."ShopifyIntegration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "AiIntegration" ADD CONSTRAINT "AiIntegration_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "AiIntegration" ADD CONSTRAINT "AiIntegration_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowId_Workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."Workflow"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowRunId_WorkflowRun_id_fk" FOREIGN KEY ("workflowRunId") REFERENCES "public"."WorkflowRun"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApprovalResponse" ADD CONSTRAINT "ApprovalResponse_approvalRequestId_ApprovalRequest_id_fk" FOREIGN KEY ("approvalRequestId") REFERENCES "public"."ApprovalRequest"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ApprovalResponse" ADD CONSTRAINT "ApprovalResponse_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_articleId_Article_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."Article"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_editorId_User_id_fk" FOREIGN KEY ("editorId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Article" ADD CONSTRAINT "Article_authorId_User_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Article" ADD CONSTRAINT "Article_knowledgeBaseId_KnowledgeBase_id_fk" FOREIGN KEY ("knowledgeBaseId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Article" ADD CONSTRAINT "Article_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Article" ADD CONSTRAINT "Article_parentId_Article_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."Article"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_fileId_FolderFile_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."FolderFile"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_fileVersionId_FileVersion_id_fk" FOREIGN KEY ("fileVersionId") REFERENCES "public"."FileVersion"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_assetId_MediaAsset_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."MediaAsset"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_assetVersionId_MediaAssetVersion_id_fk" FOREIGN KEY ("assetVersionId") REFERENCES "public"."MediaAssetVersion"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "AutoResponseRule" ADD CONSTRAINT "AutoResponseRule_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_sessionId_ChatSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."ChatSession"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_ChatMessage_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."ChatMessage"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_ChatSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."ChatSession"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_agentId_User_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_widgetId_ChatWidget_id_fk" FOREIGN KEY ("widgetId") REFERENCES "public"."ChatWidget"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_closedById_User_id_fk" FOREIGN KEY ("closedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatWidget" ADD CONSTRAINT "ChatWidget_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ChatWidget" ADD CONSTRAINT "ChatWidget_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_commentId_Comment_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."Comment"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CommentReaction" ADD CONSTRAINT "CommentReaction_commentId_Comment_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."Comment"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CommentReaction" ADD CONSTRAINT "CommentReaction_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Comment" ADD CONSTRAINT "Comment_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Comment" ADD CONSTRAINT "Comment_ticketId_Ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Comment" ADD CONSTRAINT "Comment_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Comment" ADD CONSTRAINT "Comment_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_Comment_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."Comment"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Comment" ADD CONSTRAINT "Comment_pinnedById_User_id_fk" FOREIGN KEY ("pinnedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomExtractionRule" ADD CONSTRAINT "CustomExtractionRule_templateId_ExtractionTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."ExtractionTemplate"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomExtractionRule" ADD CONSTRAINT "CustomExtractionRule_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomFieldGroup" ADD CONSTRAINT "CustomFieldGroup_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_fieldId_CustomField_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."CustomField"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomerGroupMember" ADD CONSTRAINT "CustomerGroupMember_customerGroupId_CustomerGroup_id_fk" FOREIGN KEY ("customerGroupId") REFERENCES "public"."CustomerGroup"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomerGroupMember" ADD CONSTRAINT "CustomerGroupMember_contactId_Contact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomerSource" ADD CONSTRAINT "CustomerSource_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "CustomerSource" ADD CONSTRAINT "CustomerSource_contactId_Contact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DatasetMetadata" ADD CONSTRAINT "DatasetMetadata_datasetId_Dataset_id_fk" FOREIGN KEY ("datasetId") REFERENCES "public"."Dataset"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DatasetSearchQuery" ADD CONSTRAINT "DatasetSearchQuery_datasetId_Dataset_id_fk" FOREIGN KEY ("datasetId") REFERENCES "public"."Dataset"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DatasetSearchQuery" ADD CONSTRAINT "DatasetSearchQuery_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DatasetSearchQuery" ADD CONSTRAINT "DatasetSearchQuery_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DatasetSearchResult" ADD CONSTRAINT "DatasetSearchResult_queryId_DatasetSearchQuery_id_fk" FOREIGN KEY ("queryId") REFERENCES "public"."DatasetSearchQuery"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DatasetSearchResult" ADD CONSTRAINT "DatasetSearchResult_segmentId_DocumentSegment_id_fk" FOREIGN KEY ("segmentId") REFERENCES "public"."DocumentSegment"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DocumentSegment" ADD CONSTRAINT "DocumentSegment_documentId_Document_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "DocumentSegment" ADD CONSTRAINT "DocumentSegment_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_datasetId_Dataset_id_fk" FOREIGN KEY ("datasetId") REFERENCES "public"."Dataset"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_User_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_mediaAssetId_MediaAsset_id_fk" FOREIGN KEY ("mediaAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailAIAnalysis" ADD CONSTRAINT "EmailAIAnalysis_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailAIAnalysis" ADD CONSTRAINT "EmailAIAnalysis_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_mediaAssetId_MediaAsset_id_fk" FOREIGN KEY ("mediaAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailCategory" ADD CONSTRAINT "EmailCategory_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailContentAnalysis" ADD CONSTRAINT "EmailContentAnalysis_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailEmbedding" ADD CONSTRAINT "EmailEmbedding_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailKBArticleReference" ADD CONSTRAINT "EmailKBArticleReference_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailKBArticleReference" ADD CONSTRAINT "EmailKBArticleReference_articleId_Article_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."Article"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailOrderReference" ADD CONSTRAINT "EmailOrderReference_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailOrderReference" ADD CONSTRAINT "EmailOrderReference_orderId_Order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailProcessingJob" ADD CONSTRAINT "EmailProcessingJob_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailProcessingJob" ADD CONSTRAINT "EmailProcessingJob_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailProcessingJob" ADD CONSTRAINT "EmailProcessingJob_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailProductReference" ADD CONSTRAINT "EmailProductReference_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailProductReference" ADD CONSTRAINT "EmailProductReference_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailResponse" ADD CONSTRAINT "EmailResponse_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailResponse" ADD CONSTRAINT "EmailResponse_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailResponse" ADD CONSTRAINT "EmailResponse_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailResponse" ADD CONSTRAINT "EmailResponse_analysisId_EmailAIAnalysis_id_fk" FOREIGN KEY ("analysisId") REFERENCES "public"."EmailAIAnalysis"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailRuleMatch" ADD CONSTRAINT "EmailRuleMatch_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailRuleMatch" ADD CONSTRAINT "EmailRuleMatch_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "embedding_jobs" ADD CONSTRAINT "embedding_jobs_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_jobId_embedding_jobs_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."embedding_jobs"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExecutedRuleGroup" ADD CONSTRAINT "ExecutedRuleGroup_groupId_RuleGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."RuleGroup"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExecutedRuleGroup" ADD CONSTRAINT "ExecutedRuleGroup_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExecutedRuleGroup" ADD CONSTRAINT "ExecutedRuleGroup_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExecutedRule" ADD CONSTRAINT "ExecutedRule_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExecutedRule" ADD CONSTRAINT "ExecutedRule_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExecutedRule" ADD CONSTRAINT "ExecutedRule_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExternalKnowledgeSource" ADD CONSTRAINT "ExternalKnowledgeSource_datasetId_Dataset_id_fk" FOREIGN KEY ("datasetId") REFERENCES "public"."Dataset"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExternalKnowledgeSource" ADD CONSTRAINT "ExternalKnowledgeSource_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExternalKnowledgeSource" ADD CONSTRAINT "ExternalKnowledgeSource_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ExtractionTemplate" ADD CONSTRAINT "ExtractionTemplate_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_fileId_File_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_FolderFile_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."FolderFile"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_storageLocationId_StorageLocation_id_fk" FOREIGN KEY ("storageLocationId") REFERENCES "public"."StorageLocation"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "File" ADD CONSTRAINT "File_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "File" ADD CONSTRAINT "File_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "File" ADD CONSTRAINT "File_deletedById_User_id_fk" FOREIGN KEY ("deletedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "File" ADD CONSTRAINT "File_articleId_Article_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."Article"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "File" ADD CONSTRAINT "File_knowledgeBaseId_KnowledgeBase_id_fk" FOREIGN KEY ("knowledgeBaseId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FolderFile" ADD CONSTRAINT "FolderFile_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FolderFile" ADD CONSTRAINT "FolderFile_folderId_Folder_id_fk" FOREIGN KEY ("folderId") REFERENCES "public"."Folder"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FolderFile" ADD CONSTRAINT "FolderFile_currentVersionId_FileVersion_id_fk" FOREIGN KEY ("currentVersionId") REFERENCES "public"."FileVersion"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FolderFile" ADD CONSTRAINT "FolderFile_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Folder" ADD CONSTRAINT "Folder_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_Folder_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."Folder"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Folder" ADD CONSTRAINT "Folder_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FulfillmentTracking" ADD CONSTRAINT "FulfillmentTracking_orderId_Order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "FulfillmentTracking" ADD CONSTRAINT "FulfillmentTracking_fulfillmentId_OrderFulfillment_id_fk" FOREIGN KEY ("fulfillmentId") REFERENCES "public"."OrderFulfillment"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_Group_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Group" ADD CONSTRAINT "Group_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "InboxGroupAccess" ADD CONSTRAINT "InboxGroupAccess_inboxId_Inbox_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."Inbox"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "InboxGroupAccess" ADD CONSTRAINT "InboxGroupAccess_groupId_Group_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "InboxIntegration" ADD CONSTRAINT "InboxIntegration_inboxId_Inbox_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."Inbox"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "InboxIntegration" ADD CONSTRAINT "InboxIntegration_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "InboxMemberAccess" ADD CONSTRAINT "InboxMemberAccess_inboxId_Inbox_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."Inbox"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "InboxMemberAccess" ADD CONSTRAINT "InboxMemberAccess_organizationMemberId_OrganizationMember_id_fk" FOREIGN KEY ("organizationMemberId") REFERENCES "public"."OrganizationMember"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_currentVersionId_MediaAssetVersion_id_fk" FOREIGN KEY ("currentVersionId") REFERENCES "public"."MediaAssetVersion"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MediaAssetVersion" ADD CONSTRAINT "MediaAssetVersion_assetId_MediaAsset_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."MediaAsset"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MediaAssetVersion" ADD CONSTRAINT "MediaAssetVersion_storageLocationId_StorageLocation_id_fk" FOREIGN KEY ("storageLocationId") REFERENCES "public"."StorageLocation"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MediaAssetVersion" ADD CONSTRAINT "MediaAssetVersion_derivedFromVersionId_MediaAssetVersion_id_fk" FOREIGN KEY ("derivedFromVersionId") REFERENCES "public"."MediaAssetVersion"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Organization" ADD CONSTRAINT "Organization_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Organization" ADD CONSTRAINT "Organization_systemUserId_User_id_fk" FOREIGN KEY ("systemUserId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_invitedById_User_id_fk" FOREIGN KEY ("invitedById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_acceptedById_User_id_fk" FOREIGN KEY ("acceptedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrganizationSetting" ADD CONSTRAINT "OrganizationSetting_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_organizationSettingId_OrganizationSetting_id_fk" FOREIGN KEY ("organizationSettingId") REFERENCES "public"."OrganizationSetting"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "IntegrationSchedule" ADD CONSTRAINT "IntegrationSchedule_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ShopifyIntegration" ADD CONSTRAINT "ShopifyIntegration_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ShopifyIntegration" ADD CONSTRAINT "ShopifyIntegration_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ShopifyAuthState" ADD CONSTRAINT "ShopifyAuthState_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ShopifyAuthState" ADD CONSTRAINT "ShopifyAuthState_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Participant" ADD CONSTRAINT "Participant_contactId_Contact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Participant" ADD CONSTRAINT "Participant_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadReadStatus" ADD CONSTRAINT "ThreadReadStatus_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadReadStatus" ADD CONSTRAINT "ThreadReadStatus_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadReadStatus" ADD CONSTRAINT "ThreadReadStatus_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "UserInboxUnreadCount" ADD CONSTRAINT "UserInboxUnreadCount_inboxId_Inbox_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."Inbox"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "UserInboxUnreadCount" ADD CONSTRAINT "UserInboxUnreadCount_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "UserInboxUnreadCount" ADD CONSTRAINT "UserInboxUnreadCount_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Label" ADD CONSTRAINT "Label_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Signature" ADD CONSTRAINT "Signature_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Signature" ADD CONSTRAINT "Signature_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_fromId_Participant_id_fk" FOREIGN KEY ("fromId") REFERENCES "public"."Participant"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_Participant_id_fk" FOREIGN KEY ("replyToId") REFERENCES "public"."Participant"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_signatureId_Signature_id_fk" FOREIGN KEY ("signatureId") REFERENCES "public"."Signature"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MessageParticipant" ADD CONSTRAINT "MessageParticipant_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MessageParticipant" ADD CONSTRAINT "MessageParticipant_participantId_Participant_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."Participant"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_shippingAddressId_Address_id_fk" FOREIGN KEY ("shippingAddressId") REFERENCES "public"."Address"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_billingAddressId_Address_id_fk" FOREIGN KEY ("billingAddressId") REFERENCES "public"."Address"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_shopify_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."shopify_customers"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_integrationId_ShopifyIntegration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."ShopifyIntegration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Thread" ADD CONSTRAINT "Thread_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Thread" ADD CONSTRAINT "Thread_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Thread" ADD CONSTRAINT "Thread_assigneeId_User_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Thread" ADD CONSTRAINT "Thread_inboxId_Inbox_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."Inbox"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_integrationId_ShopifyIntegration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."ShopifyIntegration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ResponseTemplate" ADD CONSTRAINT "ResponseTemplate_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadAnalysis" ADD CONSTRAINT "ThreadAnalysis_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadAnalysis" ADD CONSTRAINT "ThreadAnalysis_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadTracker" ADD CONSTRAINT "ThreadTracker_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ThreadTracker" ADD CONSTRAINT "ThreadTracker_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_integrationId_ShopifyIntegration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."ShopifyIntegration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "shopify_customers" ADD CONSTRAINT "shopify_customers_defaultAddressId_Address_id_fk" FOREIGN KEY ("defaultAddressId") REFERENCES "public"."Address"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "shopify_customers" ADD CONSTRAINT "shopify_customers_lastOrderId_Order_id_fk" FOREIGN KEY ("lastOrderId") REFERENCES "public"."Order"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "shopify_customers" ADD CONSTRAINT "shopify_customers_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "shopify_customers" ADD CONSTRAINT "shopify_customers_integrationId_ShopifyIntegration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."ShopifyIntegration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "shopify_customers" ADD CONSTRAINT "shopify_customers_contactId_Contact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_orderId_Order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_orderId_Order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_orderId_Order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_orderId_Order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_integrationId_ShopifyIntegration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."ShopifyIntegration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_subscriptionId_Subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_integrationId_ShopifyIntegration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."ShopifyIntegration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_Webhook_id_fk" FOREIGN KEY ("webhookId") REFERENCES "public"."Webhook"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "PromptHistory" ADD CONSTRAINT "PromptHistory_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Part" ADD CONSTRAINT "Part_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Part" ADD CONSTRAINT "Part_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Subpart" ADD CONSTRAINT "Subpart_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Subpart" ADD CONSTRAINT "Subpart_parentPartId_Part_id_fk" FOREIGN KEY ("parentPartId") REFERENCES "public"."Part"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Subpart" ADD CONSTRAINT "Subpart_childPartId_Part_id_fk" FOREIGN KEY ("childPartId") REFERENCES "public"."Part"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "VendorPart" ADD CONSTRAINT "VendorPart_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "VendorPart" ADD CONSTRAINT "VendorPart_partId_Part_id_fk" FOREIGN KEY ("partId") REFERENCES "public"."Part"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "VendorPart" ADD CONSTRAINT "VendorPart_vendorId_Vendor_id_fk" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_partId_Part_id_fk" FOREIGN KEY ("partId") REFERENCES "public"."Part"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketSequence" ADD CONSTRAINT "TicketSequence_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_ticketId_Ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketRelation" ADD CONSTRAINT "TicketRelation_ticketId_Ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketRelation" ADD CONSTRAINT "TicketRelation_relatedTicketId_Ticket_id_fk" FOREIGN KEY ("relatedTicketId") REFERENCES "public"."Ticket"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentTicketId_Ticket_id_fk" FOREIGN KEY ("parentTicketId") REFERENCES "public"."Ticket"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_Order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_contactId_Contact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_shopifyCustomerId_shopify_customers_id_fk" FOREIGN KEY ("shopifyCustomerId") REFERENCES "public"."shopify_customers"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_logoDarkId_MediaAsset_id_fk" FOREIGN KEY ("logoDarkId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_logoLightId_MediaAsset_id_fk" FOREIGN KEY ("logoLightId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketView" ADD CONSTRAINT "TicketView_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketView" ADD CONSTRAINT "TicketView_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketNote" ADD CONSTRAINT "TicketNote_ticketId_Ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketNote" ADD CONSTRAINT "TicketNote_authorId_User_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_ticketId_Ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_agentId_User_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_avatarAssetId_MediaAsset_id_fk" FOREIGN KEY ("avatarAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MailDomain" ADD CONSTRAINT "MailDomain_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SnippetFolder" ADD CONSTRAINT "SnippetFolder_parentId_SnippetFolder_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."SnippetFolder"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SnippetFolder" ADD CONSTRAINT "SnippetFolder_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SnippetFolder" ADD CONSTRAINT "SnippetFolder_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Snippet" ADD CONSTRAINT "Snippet_folderId_SnippetFolder_id_fk" FOREIGN KEY ("folderId") REFERENCES "public"."SnippetFolder"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Snippet" ADD CONSTRAINT "Snippet_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Snippet" ADD CONSTRAINT "Snippet_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SnippetShare" ADD CONSTRAINT "SnippetShare_snippetId_Snippet_id_fk" FOREIGN KEY ("snippetId") REFERENCES "public"."Snippet"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SnippetShare" ADD CONSTRAINT "SnippetShare_groupId_Group_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SnippetShare" ADD CONSTRAINT "SnippetShare_memberId_OrganizationMember_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."OrganizationMember"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SignatureIntegrationShare" ADD CONSTRAINT "SignatureIntegrationShare_signatureId_Signature_id_fk" FOREIGN KEY ("signatureId") REFERENCES "public"."Signature"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SignatureIntegrationShare" ADD CONSTRAINT "SignatureIntegrationShare_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MailView" ADD CONSTRAINT "MailView_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "MailView" ADD CONSTRAINT "MailView_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "OperatingHours" ADD CONSTRAINT "OperatingHours_widgetId_ChatWidget_id_fk" FOREIGN KEY ("widgetId") REFERENCES "public"."ChatWidget"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "PlanSubscription" ADD CONSTRAINT "PlanSubscription_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "PlanSubscription" ADD CONSTRAINT "PlanSubscription_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "PlanSubscription" ADD CONSTRAINT "PlanSubscription_paymentMethodId_PaymentMethod_id_fk" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."PaymentMethod"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_PlanSubscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."PlanSubscription"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Tag" ADD CONSTRAINT "Tag_parentId_Tag_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."Tag"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_User_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "session" ADD CONSTRAINT "session_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TableView" ADD CONSTRAINT "TableView_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TableView" ADD CONSTRAINT "TableView_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleGroup" ADD CONSTRAINT "RuleGroup_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleGroup" ADD CONSTRAINT "RuleGroup_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleGroupRule" ADD CONSTRAINT "RuleGroupRule_groupId_RuleGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."RuleGroup"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleGroupRule" ADD CONSTRAINT "RuleGroupRule_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleGroupRelation" ADD CONSTRAINT "RuleGroupRelation_parentId_RuleGroup_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."RuleGroup"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleGroupRelation" ADD CONSTRAINT "RuleGroupRelation_childId_RuleGroup_id_fk" FOREIGN KEY ("childId") REFERENCES "public"."RuleGroup"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestSuite" ADD CONSTRAINT "TestSuite_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestSuite" ADD CONSTRAINT "TestSuite_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestCaseInSuite" ADD CONSTRAINT "TestCaseInSuite_suiteId_TestSuite_id_fk" FOREIGN KEY ("suiteId") REFERENCES "public"."TestSuite"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestCaseInSuite" ADD CONSTRAINT "TestCaseInSuite_testCaseId_TestCase_id_fk" FOREIGN KEY ("testCaseId") REFERENCES "public"."TestCase"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleInSuite" ADD CONSTRAINT "RuleInSuite_suiteId_TestSuite_id_fk" FOREIGN KEY ("suiteId") REFERENCES "public"."TestSuite"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleInSuite" ADD CONSTRAINT "RuleInSuite_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_suiteId_TestSuite_id_fk" FOREIGN KEY ("suiteId") REFERENCES "public"."TestSuite"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_executedById_User_id_fk" FOREIGN KEY ("executedById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_runId_TestRun_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."TestRun"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testCaseId_TestCase_id_fk" FOREIGN KEY ("testCaseId") REFERENCES "public"."TestCase"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "RuleAction" ADD CONSTRAINT "RuleAction_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Rule" ADD CONSTRAINT "Rule_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Rule" ADD CONSTRAINT "Rule_ruleGroupId_RuleGroup_id_fk" FOREIGN KEY ("ruleGroupId") REFERENCES "public"."RuleGroup"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProposedAction" ADD CONSTRAINT "ProposedAction_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProposedAction" ADD CONSTRAINT "ProposedAction_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProposedAction" ADD CONSTRAINT "ProposedAction_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProposedAction" ADD CONSTRAINT "ProposedAction_approvedById_User_id_fk" FOREIGN KEY ("approvedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProposedAction" ADD CONSTRAINT "ProposedAction_rejectedById_User_id_fk" FOREIGN KEY ("rejectedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ShopifyAutomationMetrics" ADD CONSTRAINT "ShopifyAutomationMetrics_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ShopifyAutomationRule" ADD CONSTRAINT "ShopifyAutomationRule_ruleId_Rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."Rule"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "IntegrationTagLabel" ADD CONSTRAINT "IntegrationTagLabel_tagId_Tag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."Tag"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "IntegrationTagLabel" ADD CONSTRAINT "IntegrationTagLabel_labelId_Label_id_fk" FOREIGN KEY ("labelId") REFERENCES "public"."Label"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "IntegrationTagLabel" ADD CONSTRAINT "IntegrationTagLabel_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "LoadBalancingConfig" ADD CONSTRAINT "LoadBalancingConfig_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProviderPreference" ADD CONSTRAINT "ProviderPreference_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ModelConfiguration" ADD CONSTRAINT "ModelConfiguration_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_workflowAppId_WorkflowApp_id_fk" FOREIGN KEY ("workflowAppId") REFERENCES "public"."WorkflowApp"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowApp" ADD CONSTRAINT "WorkflowApp_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowApp" ADD CONSTRAINT "WorkflowApp_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowApp" ADD CONSTRAINT "WorkflowApp_workflowId_Workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."Workflow"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowApp" ADD CONSTRAINT "WorkflowApp_draftWorkflowId_Workflow_id_fk" FOREIGN KEY ("draftWorkflowId") REFERENCES "public"."Workflow"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ProviderConfiguration" ADD CONSTRAINT "ProviderConfiguration_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowAppId_WorkflowApp_id_fk" FOREIGN KEY ("workflowAppId") REFERENCES "public"."WorkflowApp"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_Workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."Workflow"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowNodeExecution" ADD CONSTRAINT "WorkflowNodeExecution_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowNodeExecution" ADD CONSTRAINT "WorkflowNodeExecution_workflowRunId_WorkflowRun_id_fk" FOREIGN KEY ("workflowRunId") REFERENCES "public"."WorkflowRun"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowNodeExecution" ADD CONSTRAINT "WorkflowNodeExecution_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowJoinState" ADD CONSTRAINT "WorkflowJoinState_workflowId_Workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."Workflow"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowFile" ADD CONSTRAINT "WorkflowFile_workflowId_Workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."Workflow"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowFile" ADD CONSTRAINT "WorkflowFile_fileId_File_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowCredentials" ADD CONSTRAINT "WorkflowCredentials_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "WorkflowCredentials" ADD CONSTRAINT "WorkflowCredentials_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_credentialId_WorkflowCredentials_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."WorkflowCredentials"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "LabelsOnThread" ADD CONSTRAINT "LabelsOnThread_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "LabelsOnThread" ADD CONSTRAINT "LabelsOnThread_labelId_Label_id_fk" FOREIGN KEY ("labelId") REFERENCES "public"."Label"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TagsOnArticle" ADD CONSTRAINT "TagsOnArticle_articleId_Article_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."Article"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TagsOnArticle" ADD CONSTRAINT "TagsOnArticle_tagId_ArticleTag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."ArticleTag"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TagsOnThread" ADD CONSTRAINT "TagsOnThread_tagId_Tag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."Tag"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "TagsOnThread" ADD CONSTRAINT "TagsOnThread_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_providerId_accountId_key" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Address_customerId_idx" ON "Address" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Address_orderId_idx" ON "Address" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiIntegration_organizationId_idx" ON "AiIntegration" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiIntegration_organizationId_isDefault_idx" ON "AiIntegration" USING btree ("organizationId","isDefault");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiIntegration_organizationId_modelType_idx" ON "AiIntegration" USING btree ("organizationId","modelType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiIntegration_organizationId_providerType_idx" ON "AiIntegration" USING btree ("organizationId","providerType");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "AiIntegration_provider_organizationId_key" ON "AiIntegration" USING btree ("provider","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiUsage_createdAt_idx" ON "AiUsage" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiUsage_organizationId_createdAt_idx" ON "AiUsage" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiUsage_provider_model_idx" ON "AiUsage" USING btree ("provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_hashedKey_key" ON "ApiKey" USING btree ("hashedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApiKey_userId_isActive_idx" ON "ApiKey" USING btree ("userId","isActive");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApprovalRequest_createdById_idx" ON "ApprovalRequest" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApprovalRequest_organizationId_assigneeGroups_idx" ON "ApprovalRequest" USING btree ("organizationId","assigneeGroups");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApprovalRequest_organizationId_assigneeUsers_idx" ON "ApprovalRequest" USING btree ("organizationId","assigneeUsers");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApprovalRequest_organizationId_idx" ON "ApprovalRequest" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApprovalRequest_workflowRunId_idx" ON "ApprovalRequest" USING btree ("workflowRunId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalResponse_approvalRequestId_userId_key" ON "ApprovalResponse" USING btree ("approvalRequestId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApprovalResponse_userId_idx" ON "ApprovalResponse" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ArticleTag_name_organizationId_key" ON "ArticleTag" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Article_isCategory_idx" ON "Article" USING btree ("isCategory");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Article_knowledgeBaseId_idx" ON "Article" USING btree ("knowledgeBaseId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Article_knowledgeBaseId_slug_key" ON "Article" USING btree ("knowledgeBaseId","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Article_parentId_idx" ON "Article" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Attachment_assetId_idx" ON "Attachment" USING btree ("assetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Attachment_createdAt_idx" ON "Attachment" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Attachment_entityType_entityId_idx" ON "Attachment" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Attachment_fileId_idx" ON "Attachment" USING btree ("fileId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Attachment_id_organizationId_key" ON "Attachment" USING btree ("id","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Attachment_organizationId_entityType_entityId_idx" ON "Attachment" USING btree ("organizationId","entityType","entityId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AutoResponseRule_organizationId_isActive_idx" ON "AutoResponseRule" USING btree ("organizationId","isActive");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "AutoResponseRule_organizationId_name_key" ON "AutoResponseRule" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AutoResponseRule_priority_idx" ON "AutoResponseRule" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatAttachment_messageId_idx" ON "ChatAttachment" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatAttachment_sessionId_idx" ON "ChatAttachment" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatMessage_agentId_idx" ON "ChatMessage" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatMessage_createdAt_idx" ON "ChatMessage" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_idx" ON "ChatMessage" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatMessage_threadId_idx" ON "ChatMessage" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatSession_lastActivityAt_idx" ON "ChatSession" USING btree ("lastActivityAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatSession_organizationId_idx" ON "ChatSession" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatSession_status_idx" ON "ChatSession" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatSession_visitorId_idx" ON "ChatSession" USING btree ("visitorId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatSession_widgetId_idx" ON "ChatSession" USING btree ("widgetId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ChatWidget_integrationId_key" ON "ChatWidget" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatWidget_organizationId_idx" ON "ChatWidget" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ChatWidget_organizationId_name_key" ON "ChatWidget" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CommentMention_commentId_idx" ON "CommentMention" USING btree ("commentId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CommentMention_commentId_userId_key" ON "CommentMention" USING btree ("commentId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CommentMention_userId_idx" ON "CommentMention" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CommentReaction_commentId_idx" ON "CommentReaction" USING btree ("commentId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CommentReaction_commentId_userId_type_emoji_key" ON "CommentReaction" USING btree ("commentId","userId","type","emoji");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CommentReaction_type_idx" ON "CommentReaction" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CommentReaction_userId_idx" ON "CommentReaction" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_createdById_idx" ON "Comment" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_deletedAt_idx" ON "Comment" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_entityId_entityType_idx" ON "Comment" USING btree ("entityId","entityType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_isPinned_idx" ON "Comment" USING btree ("isPinned");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_organizationId_idx" ON "Comment" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_parentId_idx" ON "Comment" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_threadId_idx" ON "Comment" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Comment_ticketId_idx" ON "Comment" USING btree ("ticketId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Contact_emails_idx" ON "Contact" USING gin ("emails");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_organizationId_email_key" ON "Contact" USING btree ("organizationId","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Contact_organizationId_idx" ON "Contact" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Contact_organizationId_phone_idx" ON "Contact" USING btree ("organizationId","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Contact_organizationId_status_idx" ON "Contact" USING btree ("organizationId","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CustomExtractionRule_organizationId_entityType_templateId_key" ON "CustomExtractionRule" USING btree ("organizationId","entityType","templateId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomExtractionRule_organizationId_isActive_idx" ON "CustomExtractionRule" USING btree ("organizationId","isActive");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomExtractionRule_templateId_idx" ON "CustomExtractionRule" USING btree ("templateId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomFieldGroup_modelType_idx" ON "CustomFieldGroup" USING btree ("modelType");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldGroup_name_organizationId_modelType_key" ON "CustomFieldGroup" USING btree ("name","organizationId","modelType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomFieldGroup_organizationId_idx" ON "CustomFieldGroup" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldValue_entityId_fieldId_key" ON "CustomFieldValue" USING btree ("entityId","fieldId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomFieldValue_entityId_idx" ON "CustomFieldValue" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomFieldValue_fieldId_idx" ON "CustomFieldValue" USING btree ("fieldId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomField_modelType_idx" ON "CustomField" USING btree ("modelType");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CustomField_name_organizationId_key" ON "CustomField" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomField_organizationId_idx" ON "CustomField" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerGroupMember_customerGroupId_contactId_key" ON "CustomerGroupMember" USING btree ("customerGroupId","contactId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerGroup_name_organizationId_key" ON "CustomerGroup" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomerGroup_organizationId_idx" ON "CustomerGroup" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomerSource_contactId_idx" ON "CustomerSource" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomerSource_email_idx" ON "CustomerSource" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CustomerSource_organizationId_idx" ON "CustomerSource" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSource_source_sourceId_organizationId_key" ON "CustomerSource" USING btree ("source","sourceId","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetMetadata_datasetId_idx" ON "DatasetMetadata" USING btree ("datasetId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DatasetMetadata_datasetId_name_key" ON "DatasetMetadata" USING btree ("datasetId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetMetadata_type_idx" ON "DatasetMetadata" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchQuery_createdAt_idx" ON "DatasetSearchQuery" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchQuery_datasetId_idx" ON "DatasetSearchQuery" USING btree ("datasetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchQuery_organizationId_idx" ON "DatasetSearchQuery" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchQuery_userId_idx" ON "DatasetSearchQuery" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchResult_queryId_idx" ON "DatasetSearchResult" USING btree ("queryId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DatasetSearchResult_queryId_segmentId_key" ON "DatasetSearchResult" USING btree ("queryId","segmentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchResult_rank_idx" ON "DatasetSearchResult" USING btree ("rank");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchResult_score_idx" ON "DatasetSearchResult" USING btree ("score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DatasetSearchResult_segmentId_idx" ON "DatasetSearchResult" USING btree ("segmentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Dataset_createdById_idx" ON "Dataset" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Dataset_organizationId_idx" ON "Dataset" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Dataset_organizationId_name_key" ON "Dataset" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Dataset_status_idx" ON "Dataset" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DocumentSegment_documentId_idx" ON "DocumentSegment" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DocumentSegment_organizationId_idx" ON "DocumentSegment" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DocumentSegment_position_idx" ON "DocumentSegment" USING btree ("position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_segment_active_embedding" ON "DocumentSegment" USING hnsw ("embedding" vector_l2_ops) WITH (m=16,ef_construction=64) WHERE ((enabled = true) AND ("indexStatus" = 'INDEXED'::"IndexStatus") AND (embedding IS NOT NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_segment_content_search" ON "DocumentSegment" USING gin (to_tsvector('english'::regconfig, content));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_segment_dataset_filter" ON "DocumentSegment" USING btree ("documentId") WHERE ((enabled = true) AND ("indexStatus" = 'INDEXED'::"IndexStatus") AND (embedding IS NOT NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_checksum_idx" ON "Document" USING btree ("checksum");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Document_datasetId_checksum_key" ON "Document" USING btree ("datasetId","checksum");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_datasetId_idx" ON "Document" USING btree ("datasetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_enabled_idx" ON "Document" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_mediaAssetId_idx" ON "Document" USING btree ("mediaAssetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_organizationId_idx" ON "Document" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_status_idx" ON "Document" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_type_idx" ON "Document" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Document_uploadedById_idx" ON "Document" USING btree ("uploadedById");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailAddress_integrationId_address_key" ON "EmailAddress" USING btree ("integrationId","address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailAIAnalysis_isSpam_idx" ON "EmailAIAnalysis" USING btree ("isSpam");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailAIAnalysis_messageId_key" ON "EmailAIAnalysis" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailAIAnalysis_needsResponse_idx" ON "EmailAIAnalysis" USING btree ("needsResponse");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailAIAnalysis_organizationId_idx" ON "EmailAIAnalysis" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailAttachment_mediaAssetId_idx" ON "EmailAttachment" USING btree ("mediaAssetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailAttachment_messageId_idx" ON "EmailAttachment" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailCategory_organizationId_name_key" ON "EmailCategory" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailContentAnalysis_messageId_idx" ON "EmailContentAnalysis" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailContentAnalysis_messageId_key" ON "EmailContentAnalysis" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailEmbedding_messageId_idx" ON "EmailEmbedding" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailKBArticleReference_messageId_articleId_key" ON "EmailKBArticleReference" USING btree ("messageId","articleId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailOrderReference_messageId_orderNumber_key" ON "EmailOrderReference" USING btree ("messageId","orderNumber");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailProcessingJob_messageId_idx" ON "EmailProcessingJob" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailProcessingJob_organizationId_idx" ON "EmailProcessingJob" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailProcessingJob_organizationId_messageId_key" ON "EmailProcessingJob" USING btree ("organizationId","messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailProcessingJob_status_createdAt_idx" ON "EmailProcessingJob" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailProductReference_messageId_productId_key" ON "EmailProductReference" USING btree ("messageId","productId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailResponse_messageId_idx" ON "EmailResponse" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailResponse_organizationId_idx" ON "EmailResponse" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailResponse_status_idx" ON "EmailResponse" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailRuleMatch_messageId_idx" ON "EmailRuleMatch" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailRuleMatch_messageId_ruleId_key" ON "EmailRuleMatch" USING btree ("messageId","ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailRuleMatch_ruleId_idx" ON "EmailRuleMatch" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmailTemplate_organizationId_type_idx" ON "EmailTemplate" USING btree ("organizationId","type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailTemplate_organizationId_type_isDefault_key" ON "EmailTemplate" USING btree ("organizationId","type","isDefault");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_jobs_collection_idx" ON "embedding_jobs" USING btree ("collection");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_jobs_status_idx" ON "embedding_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_collection_idx" ON "embeddings" USING btree ("collection");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_documentId_idx" ON "embeddings" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_jobId_idx" ON "embeddings" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Event_organizationId_idx" ON "Event" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Event_type_idx" ON "Event" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExecutedRuleGroup_executedAt_idx" ON "ExecutedRuleGroup" USING btree ("executedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExecutedRuleGroup_groupId_idx" ON "ExecutedRuleGroup" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExecutedRuleGroup_messageId_idx" ON "ExecutedRuleGroup" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExecutedRule_messageId_idx" ON "ExecutedRule" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExecutedRule_ruleId_idx" ON "ExecutedRule" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExecutedRule_threadId_idx" ON "ExecutedRule" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExternalKnowledgeSource_datasetId_idx" ON "ExternalKnowledgeSource" USING btree ("datasetId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalKnowledgeSource_datasetId_name_key" ON "ExternalKnowledgeSource" USING btree ("datasetId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExternalKnowledgeSource_nextSyncAt_idx" ON "ExternalKnowledgeSource" USING btree ("nextSyncAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExternalKnowledgeSource_organizationId_idx" ON "ExternalKnowledgeSource" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExternalKnowledgeSource_status_idx" ON "ExternalKnowledgeSource" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ExtractionTemplate_organizationId_idx" ON "ExtractionTemplate" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FileAttachment_attachableId_attachableType_idx" ON "FileAttachment" USING btree ("attachableId","attachableType");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "FileAttachment_fileId_attachableId_attachableType_key" ON "FileAttachment" USING btree ("fileId","attachableId","attachableType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FileVersion_fileId_createdAt_idx" ON "FileVersion" USING btree ("fileId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "FileVersion_fileId_versionNumber_key" ON "FileVersion" USING btree ("fileId","versionNumber");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "File_checksum_organizationId_idx" ON "File" USING btree ("checksum","organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "File_hashedKey_key" ON "File" USING btree ("hashedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "File_organizationId_status_idx" ON "File" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "File_status_expiresAt_idx" ON "File" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "File_visibility_hashedKey_idx" ON "File" USING btree ("visibility","hashedKey");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "FolderFile_currentVersionId_key" ON "FolderFile" USING btree ("currentVersionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_checksum_idx" ON "FolderFile" USING btree ("organizationId","checksum");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_deletedAt_isArchived_idx" ON "FolderFile" USING btree ("organizationId","deletedAt","isArchived");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_ext_createdAt_idx" ON "FolderFile" USING btree ("organizationId","ext","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_folderId_idx" ON "FolderFile" USING btree ("organizationId","folderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_folderId_path_idx" ON "FolderFile" USING btree ("organizationId","folderId","path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_mimeType_updatedAt_idx" ON "FolderFile" USING btree ("organizationId","mimeType","updatedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_name_idx" ON "FolderFile" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_path_idx" ON "FolderFile" USING btree ("organizationId","path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_organizationId_updatedAt_idx" ON "FolderFile" USING btree ("organizationId","updatedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FolderFile_path_name_idx" ON "FolderFile" USING btree ("path","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Folder_organizationId_deletedAt_isArchived_idx" ON "Folder" USING btree ("organizationId","deletedAt","isArchived");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Folder_organizationId_depth_path_idx" ON "Folder" USING btree ("organizationId","depth","path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Folder_organizationId_parentId_idx" ON "Folder" USING btree ("organizationId","parentId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Folder_organizationId_parentId_name_key" ON "Folder" USING btree ("organizationId","parentId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Folder_parentId_name_idx" ON "Folder" USING btree ("parentId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FulfillmentTracking_fulfillmentId_idx" ON "FulfillmentTracking" USING btree ("fulfillmentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FulfillmentTracking_number_idx" ON "FulfillmentTracking" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "FulfillmentTracking_number_key" ON "FulfillmentTracking" USING btree ("number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FulfillmentTracking_orderId_idx" ON "FulfillmentTracking" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GroupMember_groupId_idx" ON "GroupMember" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "GroupMember_groupId_userId_key" ON "GroupMember" USING btree ("groupId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GroupMember_userId_idx" ON "GroupMember" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Group_name_organizationId_key" ON "Group" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Group_organizationId_idx" ON "Group" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "InboxGroupAccess_groupId_idx" ON "InboxGroupAccess" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "InboxGroupAccess_inboxId_groupId_key" ON "InboxGroupAccess" USING btree ("inboxId","groupId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "InboxGroupAccess_inboxId_idx" ON "InboxGroupAccess" USING btree ("inboxId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "InboxIntegration_inboxId_idx" ON "InboxIntegration" USING btree ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "InboxIntegration_inboxId_integrationId_key" ON "InboxIntegration" USING btree ("inboxId","integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "InboxIntegration_integrationId_key" ON "InboxIntegration" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "InboxMemberAccess_inboxId_idx" ON "InboxMemberAccess" USING btree ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "InboxMemberAccess_inboxId_organizationMemberId_key" ON "InboxMemberAccess" USING btree ("inboxId","organizationMemberId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "InboxMemberAccess_organizationMemberId_idx" ON "InboxMemberAccess" USING btree ("organizationMemberId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Inbox_organizationId_idx" ON "Inbox" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Inbox_organizationId_name_key" ON "Inbox" USING btree ("organizationId","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "MediaAsset_currentVersionId_key" ON "MediaAsset" USING btree ("currentVersionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAsset_expiresAt_idx" ON "MediaAsset" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "MediaAsset_id_organizationId_key" ON "MediaAsset" USING btree ("id","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAsset_kind_isPrivate_idx" ON "MediaAsset" USING btree ("kind","isPrivate");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAsset_organizationId_expiresAt_idx" ON "MediaAsset" USING btree ("organizationId","expiresAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAsset_organizationId_kind_idx" ON "MediaAsset" USING btree ("organizationId","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAsset_organizationId_purpose_kind_idx" ON "MediaAsset" USING btree ("organizationId","purpose","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thumbnail_assets" ON "MediaAsset" USING btree ("organizationId","kind") WHERE ((kind = 'THUMBNAIL'::text) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAssetVersion_assetId_createdAt_idx" ON "MediaAssetVersion" USING btree ("assetId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "MediaAssetVersion_assetId_versionNumber_key" ON "MediaAssetVersion" USING btree ("assetId","versionNumber");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "MediaAssetVersion_derivedFromVersionId_preset_key" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAssetVersion_derivedFromVersionId_preset_status_idx" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MediaAssetVersion_status_idx" ON "MediaAssetVersion" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thumbnail_cleanup" ON "MediaAssetVersion" USING btree ("derivedFromVersionId") WHERE (("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thumbnail_lookup_covering" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset","id") WHERE (("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_thumbnail" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset") WHERE (("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Organization_handle_idx" ON "Organization" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_handle_key" ON "Organization" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_systemUserId_key" ON "Organization" USING btree ("systemUserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationMember_organizationId_idx" ON "OrganizationMember" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationMember_userId_idx" ON "OrganizationMember" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMember_userId_organizationId_key" ON "OrganizationMember" USING btree ("userId","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationInvitation_email_idx" ON "OrganizationInvitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationInvitation_organizationId_idx" ON "OrganizationInvitation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationInvitation_status_idx" ON "OrganizationInvitation" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationInvitation_token_key" ON "OrganizationInvitation" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationSetting_key_idx" ON "OrganizationSetting" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationSetting_organizationId_idx" ON "OrganizationSetting" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationSetting_organizationId_key_key" ON "OrganizationSetting" USING btree ("organizationId","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrganizationSetting_scope_idx" ON "OrganizationSetting" USING btree ("scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserSetting_organizationSettingId_idx" ON "UserSetting" USING btree ("organizationSettingId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserSetting_userId_idx" ON "UserSetting" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UserSetting_userId_organizationSettingId_key" ON "UserSetting" USING btree ("userId","organizationSettingId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IntegrationSchedule_integrationId_idx" ON "IntegrationSchedule" USING btree ("integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationSchedule_integrationId_key" ON "IntegrationSchedule" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ShopifyIntegration_organizationId_idx" ON "ShopifyIntegration" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyIntegration_organizationId_shopDomain_key" ON "ShopifyIntegration" USING btree ("organizationId","shopDomain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ShopifyIntegration_shopDomain_idx" ON "ShopifyIntegration" USING btree ("shopDomain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ShopifyAuthState_state_idx" ON "ShopifyAuthState" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ShopifyAuthState_userId_idx" ON "ShopifyAuthState" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Participant_contactId_idx" ON "Participant" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Participant_identifierType_idx" ON "Participant" USING btree ("identifierType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Participant_identifier_idx" ON "Participant" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Participant_organizationId_identifier_identifierType_key" ON "Participant" USING btree ("organizationId","identifier","identifierType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Participant_organizationId_idx" ON "Participant" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key" ON "VerificationToken" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "VerificationToken_userId_idx" ON "VerificationToken" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadReadStatus_isRead_idx" ON "ThreadReadStatus" USING btree ("isRead");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadReadStatus_organizationId_idx" ON "ThreadReadStatus" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadReadStatus_organizationId_userId_idx" ON "ThreadReadStatus" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadReadStatus_threadId_idx" ON "ThreadReadStatus" USING btree ("threadId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ThreadReadStatus_threadId_userId_key" ON "ThreadReadStatus" USING btree ("threadId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadReadStatus_userId_idx" ON "ThreadReadStatus" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadReadStatus_userId_isRead_idx" ON "ThreadReadStatus" USING btree ("userId","isRead");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserInboxUnreadCount_inboxId_idx" ON "UserInboxUnreadCount" USING btree ("inboxId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserInboxUnreadCount_organizationId_idx" ON "UserInboxUnreadCount" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UserInboxUnreadCount_organizationId_inboxId_userId_key" ON "UserInboxUnreadCount" USING btree ("organizationId","inboxId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserInboxUnreadCount_organizationId_userId_idx" ON "UserInboxUnreadCount" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserInboxUnreadCount_userId_idx" ON "UserInboxUnreadCount" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Label_labelId_organizationId_integrationId_key" ON "Label" USING btree ("labelId","organizationId","integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Label_name_organizationId_integrationId_key" ON "Label" USING btree ("name","organizationId","integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Signature_createdById_idx" ON "Signature" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Signature_isDefault_idx" ON "Signature" USING btree ("isDefault");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Signature_organizationId_idx" ON "Signature" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Signature_sharingType_idx" ON "Signature" USING btree ("sharingType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_createdById_idx" ON "Message" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_emailLabel_idx" ON "Message" USING btree ("emailLabel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_fromId_idx" ON "Message" USING btree ("fromId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Message_integrationId_externalId_key" ON "Message" USING btree ("integrationId","externalId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_integrationId_idx" ON "Message" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_organizationId_idx" ON "Message" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Message_organizationId_internetMessageId_key" ON "Message" USING btree ("organizationId","internetMessageId") WHERE ("internetMessageId" IS NOT NULL);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message" USING btree ("replyToId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Message_sendToken_key" ON "Message" USING btree ("sendToken") WHERE ("sendToken" IS NOT NULL);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_sentAt_idx" ON "Message" USING btree ("sentAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_threadId_createdById_draftMode_idx" ON "Message" USING btree ("threadId","createdById","draftMode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_threadId_idx" ON "Message" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retry_queue_idx" ON "Message" USING btree ("organizationId","sendStatus","lastAttemptAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_messages_idx" ON "Message" USING btree ("threadId","draftMode","sentAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MessageParticipant_messageId_idx" ON "MessageParticipant" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "MessageParticipant_messageId_participantId_role_key" ON "MessageParticipant" USING btree ("messageId","participantId","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MessageParticipant_participantId_idx" ON "MessageParticipant" USING btree ("participantId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MessageParticipant_role_idx" ON "MessageParticipant" USING btree ("role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_history_idx" ON "MessageParticipant" USING btree ("contactId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "participant_lookup_idx" ON "MessageParticipant" USING btree ("messageId","contactId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Order_customerId_idx" ON "Order" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Order_name_idx" ON "Order" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_inboxId_idx" ON "Thread" USING btree ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Thread_integrationId_externalId_key" ON "Thread" USING btree ("integrationId","externalId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_integrationId_idx" ON "Thread" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_lastMessageAt_idx" ON "Thread" USING btree ("lastMessageAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_organizationId_assigneeId_status_idx" ON "Thread" USING btree ("organizationId","assigneeId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_organizationId_createdAt_idx" ON "Thread" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_organizationId_idx" ON "Thread" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_organizationId_messageType_status_idx" ON "Thread" USING btree ("organizationId","messageType","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_organizationId_status_idx" ON "Thread" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Thread_status_idx" ON "Thread" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_pagination_idx" ON "Thread" USING btree ("organizationId","lastMessageAt" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_participants_idx" ON "Thread" USING btree ("organizationId","participantIds");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Product_handle_key" ON "Product" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Integration_organizationId_email_key" ON "Integration" USING btree ("organizationId","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Integration_organizationId_idx" ON "Integration" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Integration_provider_organizationId_idx" ON "Integration" USING btree ("provider","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ResponseTemplate_organizationId_isActive_idx" ON "ResponseTemplate" USING btree ("organizationId","isActive");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ResponseTemplate_organizationId_name_key" ON "ResponseTemplate" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadAnalysis_organizationId_priority_idx" ON "ThreadAnalysis" USING btree ("organizationId","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadAnalysis_organizationId_status_idx" ON "ThreadAnalysis" USING btree ("organizationId","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ThreadAnalysis_threadId_key" ON "ThreadAnalysis" USING btree ("threadId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ThreadParticipant_threadId_email_key" ON "ThreadParticipant" USING btree ("threadId","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadTracker_organizationId_resolved_idx" ON "ThreadTracker" USING btree ("organizationId","resolved");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadTracker_organizationId_resolved_sentAt_type_idx" ON "ThreadTracker" USING btree ("organizationId","resolved","sentAt","type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ThreadTracker_organizationId_threadId_messageId_key" ON "ThreadTracker" USING btree ("organizationId","threadId","messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ThreadTracker_organizationId_type_resolved_sentAt_idx" ON "ThreadTracker" USING btree ("organizationId","type","resolved","sentAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant" USING btree ("productId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProductMedia_productId_idx" ON "ProductMedia" USING btree ("productId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProductOption_productId_idx" ON "ProductOption" USING btree ("productId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_customers_contactId_idx" ON "shopify_customers" USING btree ("contactId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopify_customers_defaultAddressId_key" ON "shopify_customers" USING btree ("defaultAddressId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_customers_email_idx" ON "shopify_customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopify_customers_lastOrderId_key" ON "shopify_customers" USING btree ("lastOrderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_customers_phone_idx" ON "shopify_customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrderRefund_orderId_idx" ON "OrderRefund" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrderReturn_orderId_idx" ON "OrderReturn" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrderLineItem_orderId_idx" ON "OrderLineItem" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrderFulfillment_orderId_idx" ON "OrderFulfillment" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OrderFulfillment_status_idx" ON "OrderFulfillment" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_provider_integrationId_topic_key" ON "Subscription" USING btree ("provider","integrationId","topic");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WebhookEvent_integrationId_idx" ON "WebhookEvent" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WebhookEvent_organizationId_idx" ON "WebhookEvent" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Webhook_organizationId_idx" ON "Webhook" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WebhookDelivery_webhookId_idx" ON "WebhookDelivery" USING btree ("webhookId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Part_sku_key" ON "Part" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Subpart_parentPartId_childPartId_key" ON "Subpart" USING btree ("parentPartId","childPartId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "VendorPart_partId_vendorId_key" ON "VendorPart" USING btree ("partId","vendorId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Inventory_partId_key" ON "Inventory" USING btree ("partId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TicketSequence_organizationId_key" ON "TicketSequence" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TicketReply_mailgunMessageId_key" ON "TicketReply" USING btree ("mailgunMessageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TicketReply_messageId_idx" ON "TicketReply" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TicketReply_messageId_key" ON "TicketReply" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TicketReply_ticketId_idx" ON "TicketReply" USING btree ("ticketId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TicketRelation_ticketId_relatedTicketId_key" ON "TicketRelation" USING btree ("ticketId","relatedTicketId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ticket_contactId_idx" ON "Ticket" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ticket_emailThreadId_idx" ON "Ticket" USING btree ("emailThreadId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_mailgunMessageId_key" ON "Ticket" USING btree ("mailgunMessageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ticket_organizationId_idx" ON "Ticket" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ticket_status_idx" ON "Ticket" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ticket_type_idx" ON "Ticket" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBase_logoDarkId_key" ON "KnowledgeBase" USING btree ("logoDarkId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBase_logoLightId_key" ON "KnowledgeBase" USING btree ("logoLightId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "KnowledgeBase_organizationId_idx" ON "KnowledgeBase" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBase_organizationId_slug_key" ON "KnowledgeBase" USING btree ("organizationId","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TicketNote_authorId_idx" ON "TicketNote" USING btree ("authorId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TicketNote_ticketId_idx" ON "TicketNote" USING btree ("ticketId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TicketAssignment_ticketId_agentId_isActive_key" ON "TicketAssignment" USING btree ("ticketId","agentId","isActive");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "User_avatarAssetId_key" ON "User" USING btree ("avatarAssetId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "MailDomain_organizationId_domain_key" ON "MailDomain" USING btree ("organizationId","domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SnippetFolder_createdById_idx" ON "SnippetFolder" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SnippetFolder_organizationId_idx" ON "SnippetFolder" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "SnippetFolder_organizationId_parentId_name_key" ON "SnippetFolder" USING btree ("organizationId","parentId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Snippet_createdById_idx" ON "Snippet" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Snippet_folderId_idx" ON "Snippet" USING btree ("folderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Snippet_organizationId_idx" ON "Snippet" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Snippet_sharingType_idx" ON "Snippet" USING btree ("sharingType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SnippetShare_groupId_idx" ON "SnippetShare" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SnippetShare_memberId_idx" ON "SnippetShare" USING btree ("memberId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "SnippetShare_snippetId_groupId_memberId_key" ON "SnippetShare" USING btree ("snippetId","groupId","memberId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SnippetShare_snippetId_idx" ON "SnippetShare" USING btree ("snippetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SignatureIntegrationShare_integrationId_idx" ON "SignatureIntegrationShare" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SignatureIntegrationShare_signatureId_idx" ON "SignatureIntegrationShare" USING btree ("signatureId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "SignatureIntegrationShare_signatureId_integrationId_key" ON "SignatureIntegrationShare" USING btree ("signatureId","integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MailView_isDefault_idx" ON "MailView" USING btree ("isDefault");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "MailView_name_userId_organizationId_key" ON "MailView" USING btree ("name","userId","organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MailView_organizationId_idx" ON "MailView" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "MailView_userId_idx" ON "MailView" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "OperatingHours_widgetId_dayOfWeek_key" ON "OperatingHours" USING btree ("widgetId","dayOfWeek");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "OperatingHours_widgetId_idx" ON "OperatingHours" USING btree ("widgetId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PlanSubscription_organizationId_key" ON "PlanSubscription" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PlanSubscription_stripeCustomerId_key" ON "PlanSubscription" USING btree ("stripeCustomerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PaymentMethod_organizationId_idx" ON "PaymentMethod" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_idx" ON "Invoice" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_stripeInvoiceId_key" ON "Invoice" USING btree ("stripeInvoiceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice" USING btree ("subscriptionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Tag_organizationId_idx" ON "Tag" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Tag_parentId_idx" ON "Tag" USING btree ("parentId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_title_organizationId_parentId_key" ON "Tag" USING btree ("title","organizationId","parentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_entityType_entityId_idx" ON "Notification" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_organizationId_idx" ON "Notification" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification" USING btree ("userId","isRead");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_key" ON "session" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TwoFactor_userId_key" ON "TwoFactor" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SyncJob_organizationId_integrationCategory_integrationId_idx" ON "SyncJob" USING btree ("organizationId","integrationCategory","integrationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SyncJob_organizationId_integrationCategory_status_idx" ON "SyncJob" USING btree ("organizationId","integrationCategory","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SyncJob_organizationId_type_status_idx" ON "SyncJob" USING btree ("organizationId","type","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TableView_tableId_organizationId_idx" ON "TableView" USING btree ("tableId","organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TableView_tableId_organizationId_isDefault_key" ON "TableView" USING btree ("tableId","organizationId","isDefault");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TableView_tableId_userId_idx" ON "TableView" USING btree ("tableId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TableView_tableId_userId_name_key" ON "TableView" USING btree ("tableId","userId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleGroup_enabled_idx" ON "RuleGroup" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleGroup_organizationId_enabled_idx" ON "RuleGroup" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleGroup_organizationId_idx" ON "RuleGroup" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleGroupRule_groupId_idx" ON "RuleGroupRule" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "RuleGroupRule_groupId_ruleId_key" ON "RuleGroupRule" USING btree ("groupId","ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleGroupRule_ruleId_idx" ON "RuleGroupRule" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleGroupRelation_childId_idx" ON "RuleGroupRelation" USING btree ("childId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "RuleGroupRelation_parentId_childId_key" ON "RuleGroupRelation" USING btree ("parentId","childId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleGroupRelation_parentId_idx" ON "RuleGroupRelation" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestCase_createdById_idx" ON "TestCase" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestCase_organizationId_idx" ON "TestCase" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestCase_status_idx" ON "TestCase" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestSuite_organizationId_idx" ON "TestSuite" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestCaseInSuite_suiteId_idx" ON "TestCaseInSuite" USING btree ("suiteId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TestCaseInSuite_suiteId_testCaseId_key" ON "TestCaseInSuite" USING btree ("suiteId","testCaseId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestCaseInSuite_testCaseId_idx" ON "TestCaseInSuite" USING btree ("testCaseId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleInSuite_ruleId_idx" ON "RuleInSuite" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleInSuite_suiteId_idx" ON "RuleInSuite" USING btree ("suiteId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "RuleInSuite_suiteId_ruleId_key" ON "RuleInSuite" USING btree ("suiteId","ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestRun_organizationId_idx" ON "TestRun" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestRun_startedAt_idx" ON "TestRun" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestRun_status_idx" ON "TestRun" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestRun_suiteId_idx" ON "TestRun" USING btree ("suiteId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestResult_passed_idx" ON "TestResult" USING btree ("passed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestResult_runId_idx" ON "TestResult" USING btree ("runId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TestResult_testCaseId_idx" ON "TestResult" USING btree ("testCaseId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleAction_ruleId_idx" ON "RuleAction" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RuleAction_ruleId_order_idx" ON "RuleAction" USING btree ("ruleId","order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Rule_organizationId_enabled_idx" ON "Rule" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Rule_organizationId_name_key" ON "Rule" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Rule_organizationId_staticRuleType_idx" ON "Rule" USING btree ("organizationId","staticRuleType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Rule_organizationId_type_enabled_idx" ON "Rule" USING btree ("organizationId","type","enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Rule_organizationId_type_idx" ON "Rule" USING btree ("organizationId","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProposedAction_messageId_idx" ON "ProposedAction" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProposedAction_organizationId_status_idx" ON "ProposedAction" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProposedAction_ruleId_idx" ON "ProposedAction" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProposedAction_status_createdAt_idx" ON "ProposedAction" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ShopifyAutomationMetrics_date_idx" ON "ShopifyAutomationMetrics" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyAutomationMetrics_organizationId_date_key" ON "ShopifyAutomationMetrics" USING btree ("organizationId","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ShopifyAutomationRule_ruleId_idx" ON "ShopifyAutomationRule" USING btree ("ruleId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyAutomationRule_ruleId_key" ON "ShopifyAutomationRule" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IntegrationTagLabel_integrationId_idx" ON "IntegrationTagLabel" USING btree ("integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationTagLabel_integrationId_labelId_key" ON "IntegrationTagLabel" USING btree ("integrationId","labelId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationTagLabel_integrationId_tagId_key" ON "IntegrationTagLabel" USING btree ("integrationId","tagId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IntegrationTagLabel_organizationId_idx" ON "IntegrationTagLabel" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SearchHistory_userId_organizationId_searchedAt_idx" ON "SearchHistory" USING btree ("userId","organizationId","searchedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LoadBalancingConfig_organizationId_provider_model_idx" ON "LoadBalancingConfig" USING btree ("organizationId","provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "LoadBalancingConfig_organizationId_provider_model_modelType_key" ON "LoadBalancingConfig" USING btree ("organizationId","provider","model","modelType","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProviderPreference_organizationId_provider_idx" ON "ProviderPreference" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderPreference_organizationId_provider_key" ON "ProviderPreference" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ModelConfiguration_organizationId_enabled_idx" ON "ModelConfiguration" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ModelConfiguration_organizationId_provider_idx" ON "ModelConfiguration" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ModelConfiguration_organizationId_provider_model_modelType_key" ON "ModelConfiguration" USING btree ("organizationId","provider","model","modelType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Workflow_organizationId_enabled_idx" ON "Workflow" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Workflow_organizationId_triggerType_idx" ON "Workflow" USING btree ("organizationId","triggerType");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowApp_draftWorkflowId_key" ON "WorkflowApp" USING btree ("draftWorkflowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowApp_organizationId_enabled_idx" ON "WorkflowApp" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowApp_organizationId_isPublic_idx" ON "WorkflowApp" USING btree ("organizationId","isPublic");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowApp_workflowId_key" ON "WorkflowApp" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProviderConfiguration_organizationId_provider_idx" ON "ProviderConfiguration" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderConfiguration_organizationId_provider_key" ON "ProviderConfiguration" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowRun_createdAt_idx" ON "WorkflowRun" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowRun_organizationId_workflowAppId_idx" ON "WorkflowRun" USING btree ("organizationId","workflowAppId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowRun_resumeAt_idx" ON "WorkflowRun" USING btree ("resumeAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowRun_status_idx" ON "WorkflowRun" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowRun_workflowId_idx" ON "WorkflowRun" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowNodeExecution_nodeId_idx" ON "WorkflowNodeExecution" USING btree ("nodeId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowNodeExecution_status_idx" ON "WorkflowNodeExecution" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowNodeExecution_workflowRunId_idx" ON "WorkflowNodeExecution" USING btree ("workflowRunId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowJoinState_executionId_idx" ON "WorkflowJoinState" USING btree ("executionId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowJoinState_executionId_joinNodeId_key" ON "WorkflowJoinState" USING btree ("executionId","joinNodeId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowJoinState_workflowId_idx" ON "WorkflowJoinState" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowFile_expiresAt_idx" ON "WorkflowFile" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowFile_nodeId_idx" ON "WorkflowFile" USING btree ("nodeId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowFile_workflowId_fileId_key" ON "WorkflowFile" USING btree ("workflowId","fileId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowFile_workflowId_idx" ON "WorkflowFile" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowCredentials_createdById_idx" ON "WorkflowCredentials" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowCredentials_organizationId_idx" ON "WorkflowCredentials" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "WorkflowCredentials_organizationId_type_idx" ON "WorkflowCredentials" USING btree ("organizationId","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "StorageLocation_credentialId_idx" ON "StorageLocation" USING btree ("credentialId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "StorageLocation_provider_externalId_idx" ON "StorageLocation" USING btree ("provider","externalId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UploadSession_organizationId_createdById_idx" ON "UploadSession" USING btree ("organizationId","createdById");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UploadSession_provider_externalId_idx" ON "UploadSession" USING btree ("provider","externalId");
