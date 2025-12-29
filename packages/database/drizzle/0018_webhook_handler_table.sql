CREATE TABLE "AppWebhookHandler" (
	"id" text PRIMARY KEY NOT NULL,
	"appInstallationId" text NOT NULL,
	"handlerId" text NOT NULL,
	"url" text NOT NULL,
	"externalWebhookId" text,
	"metadata" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AppWebhookHandler" ADD CONSTRAINT "AppWebhookHandler_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "AppWebhookHandler_unique_idx" ON "AppWebhookHandler" USING btree ("appInstallationId","handlerId");--> statement-breakpoint
CREATE INDEX "AppWebhookHandler_appInstallationId_idx" ON "AppWebhookHandler" USING btree ("appInstallationId");