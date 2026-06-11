ALTER TABLE "WorkflowCredentials" RENAME TO "Credential";--> statement-breakpoint
ALTER TABLE "Credential" RENAME COLUMN "encryptedData" TO "encryptedSecrets";--> statement-breakpoint
ALTER TABLE "Credential" RENAME COLUMN "lastTokenRefreshAt" TO "lastRefreshAt";--> statement-breakpoint
ALTER TABLE "AppWebhookHandler" DROP CONSTRAINT "AppWebhookHandler_connectionId_WorkflowCredentials_id_fk";
--> statement-breakpoint
ALTER TABLE "CustomField" DROP CONSTRAINT "CustomField_connectionId_WorkflowCredentials_id_fk";
--> statement-breakpoint
ALTER TABLE "Integration" DROP CONSTRAINT "Integration_credentialId_WorkflowCredentials_id_fk";
--> statement-breakpoint
ALTER TABLE "StorageLocation" DROP CONSTRAINT "StorageLocation_credentialId_WorkflowCredentials_id_fk";
--> statement-breakpoint
ALTER TABLE "Credential" DROP CONSTRAINT "WorkflowCredentials_organizationId_Organization_id_fk";
--> statement-breakpoint
ALTER TABLE "Credential" DROP CONSTRAINT "WorkflowCredentials_createdById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Credential" DROP CONSTRAINT "WorkflowCredentials_userId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Credential" DROP CONSTRAINT "WorkflowCredentials_appId_App_id_fk";
--> statement-breakpoint
ALTER TABLE "Credential" DROP CONSTRAINT "WorkflowCredentials_appInstallationId_AppInstallation_id_fk";
--> statement-breakpoint
ALTER TABLE "Credential" DROP CONSTRAINT "WorkflowCredentials_mcpServerId_McpServer_id_fk";
--> statement-breakpoint
DROP INDEX "WorkflowCredentials_createdById_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_organizationId_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_organizationId_type_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_appId_organizationId_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_userId_appId_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_appInstallationId_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_mcpServerId_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_expiresAt_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_lastTokenRefreshAt_idx";--> statement-breakpoint
ALTER TABLE "Credential" ADD COLUMN "kind" text DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "Credential" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "AppWebhookHandler" ADD CONSTRAINT "AppWebhookHandler_connectionId_Credential_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."Credential"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_connectionId_Credential_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."Credential"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_credentialId_Credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."Credential"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_credentialId_Credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."Credential"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_mcpServerId_McpServer_id_fk" FOREIGN KEY ("mcpServerId") REFERENCES "public"."McpServer"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Credential_createdById_idx" ON "Credential" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Credential_organizationId_idx" ON "Credential" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Credential_organizationId_kind_idx" ON "Credential" USING btree ("organizationId","kind");--> statement-breakpoint
CREATE INDEX "Credential_appId_organizationId_idx" ON "Credential" USING btree ("appId","organizationId");--> statement-breakpoint
CREATE INDEX "Credential_userId_appId_idx" ON "Credential" USING btree ("userId","appId");--> statement-breakpoint
CREATE INDEX "Credential_appInstallationId_idx" ON "Credential" USING btree ("appInstallationId");--> statement-breakpoint
CREATE INDEX "Credential_mcpServerId_idx" ON "Credential" USING btree ("mcpServerId","organizationId");--> statement-breakpoint
CREATE INDEX "Credential_expiresAt_idx" ON "Credential" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "Credential_lastRefreshAt_idx" ON "Credential" USING btree ("lastRefreshAt");