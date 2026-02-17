ALTER TABLE "Contact" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "CustomerGroupMember" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "CustomerGroup" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "CustomerSource" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Signature" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TicketRelation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Ticket" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TicketAssignment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "Contact" CASCADE;--> statement-breakpoint
DROP TABLE "CustomerGroupMember" CASCADE;--> statement-breakpoint
DROP TABLE "CustomerGroup" CASCADE;--> statement-breakpoint
DROP TABLE "CustomerSource" CASCADE;--> statement-breakpoint
DROP TABLE "Signature" CASCADE;--> statement-breakpoint
DROP TABLE "TicketRelation" CASCADE;--> statement-breakpoint
DROP TABLE "Ticket" CASCADE;--> statement-breakpoint
DROP TABLE "TicketAssignment" CASCADE;--> statement-breakpoint
ALTER TABLE "AiUsage" DROP CONSTRAINT "AiUsage_userId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "ApprovalResponse" DROP CONSTRAINT "ApprovalResponse_userId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "ArticleRevision" DROP CONSTRAINT "ArticleRevision_editorId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Article" DROP CONSTRAINT "Article_authorId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_agentId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_closedById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_pinnedById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Document" DROP CONSTRAINT "Document_uploadedById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "File" DROP CONSTRAINT "File_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "File" DROP CONSTRAINT "File_deletedById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "FolderFile" DROP CONSTRAINT "FolderFile_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Folder" DROP CONSTRAINT "Folder_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Organization" DROP CONSTRAINT "Organization_systemUserId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "OrganizationInvitation" DROP CONSTRAINT "OrganizationInvitation_acceptedById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "ShopifyIntegration" DROP CONSTRAINT "ShopifyIntegration_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Message" DROP CONSTRAINT "Message_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Thread" DROP CONSTRAINT "Thread_assigneeId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Part" DROP CONSTRAINT "Part_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "TicketReply" DROP CONSTRAINT "TicketReply_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_actorId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Workflow" DROP CONSTRAINT "Workflow_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "WorkflowApp" DROP CONSTRAINT "WorkflowApp_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "WorkflowRun" DROP CONSTRAINT "WorkflowRun_createdBy_User_id_fk";
--> statement-breakpoint
ALTER TABLE "WorkflowNodeExecution" DROP CONSTRAINT "WorkflowNodeExecution_createdById_User_id_fk";
--> statement-breakpoint
DROP INDEX "shopify_customers_contactId_idx";--> statement-breakpoint
DROP INDEX "VendorPart_partId_contactId_key";--> statement-breakpoint
DROP INDEX "TicketReply_mailgunMessageId_key";--> statement-breakpoint
DROP INDEX "TicketReply_ticketId_idx";--> statement-breakpoint
DROP INDEX "SignatureIntegrationShare_signatureId_idx";--> statement-breakpoint
DROP INDEX "SignatureIntegrationShare_signatureId_integrationId_key";--> statement-breakpoint
DROP INDEX "contact_history_idx";--> statement-breakpoint
DROP INDEX "participant_lookup_idx";--> statement-breakpoint
ALTER TABLE "Attachment" ALTER COLUMN "createdById" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "FolderFile" ALTER COLUMN "createdById" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "Folder" ALTER COLUMN "createdById" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ShopifyIntegration" ALTER COLUMN "createdById" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "WorkflowRun" ALTER COLUMN "createdBy" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "MessageParticipant" ADD COLUMN "entityInstanceId" text;--> statement-breakpoint
ALTER TABLE "shopify_customers" ADD COLUMN "entityInstanceId" text;--> statement-breakpoint
DELETE FROM "VendorPart";--> statement-breakpoint
DELETE FROM "TicketReply";--> statement-breakpoint
DELETE FROM "SignatureIntegrationShare";--> statement-breakpoint
ALTER TABLE "VendorPart" ADD COLUMN "entityInstanceId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "TicketReply" ADD COLUMN "entityInstanceId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "TicketReply" ADD COLUMN "organizationId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "SignatureIntegrationShare" ADD COLUMN "entityInstanceId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ApprovalResponse" ADD CONSTRAINT "ApprovalResponse_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_editorId_User_id_fk" FOREIGN KEY ("editorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Article" ADD CONSTRAINT "Article_authorId_User_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_agentId_User_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_closedById_User_id_fk" FOREIGN KEY ("closedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_pinnedById_User_id_fk" FOREIGN KEY ("pinnedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_User_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "File" ADD CONSTRAINT "File_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "File" ADD CONSTRAINT "File_deletedById_User_id_fk" FOREIGN KEY ("deletedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FolderFile" ADD CONSTRAINT "FolderFile_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_systemUserId_User_id_fk" FOREIGN KEY ("systemUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_acceptedById_User_id_fk" FOREIGN KEY ("acceptedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ShopifyIntegration" ADD CONSTRAINT "ShopifyIntegration_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Message" ADD CONSTRAINT "Message_signatureId_EntityInstance_id_fk" FOREIGN KEY ("signatureId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Message" ADD CONSTRAINT "Message_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_assigneeId_User_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "shopify_customers" ADD CONSTRAINT "shopify_customers_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Part" ADD CONSTRAINT "Part_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "VendorPart" ADD CONSTRAINT "VendorPart_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SignatureIntegrationShare" ADD CONSTRAINT "SignatureIntegrationShare_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_User_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD CONSTRAINT "WorkflowApp_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkflowNodeExecution" ADD CONSTRAINT "WorkflowNodeExecution_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "shopify_customers_entityInstanceId_idx" ON "shopify_customers" USING btree ("entityInstanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "VendorPart_partId_entityInstanceId_key" ON "VendorPart" USING btree ("partId","entityInstanceId");--> statement-breakpoint
CREATE INDEX "TicketReply_entityInstanceId_idx" ON "TicketReply" USING btree ("entityInstanceId");--> statement-breakpoint
CREATE INDEX "TicketReply_organizationId_idx" ON "TicketReply" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "SignatureIntegrationShare_entityInstanceId_idx" ON "SignatureIntegrationShare" USING btree ("entityInstanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "SignatureIntegrationShare_entityInstanceId_integrationId_key" ON "SignatureIntegrationShare" USING btree ("entityInstanceId","integrationId");--> statement-breakpoint
CREATE INDEX "contact_history_idx" ON "MessageParticipant" USING btree ("entityInstanceId","createdAt");--> statement-breakpoint
CREATE INDEX "participant_lookup_idx" ON "MessageParticipant" USING btree ("messageId","entityInstanceId");--> statement-breakpoint
ALTER TABLE "MessageParticipant" DROP COLUMN "contactId";--> statement-breakpoint
ALTER TABLE "shopify_customers" DROP COLUMN "contactId";--> statement-breakpoint
ALTER TABLE "VendorPart" DROP COLUMN "contactId";--> statement-breakpoint
ALTER TABLE "TicketReply" DROP COLUMN "ticketId";--> statement-breakpoint
ALTER TABLE "TicketReply" DROP COLUMN "mailgunMessageId";--> statement-breakpoint
ALTER TABLE "SignatureIntegrationShare" DROP COLUMN "signatureId";