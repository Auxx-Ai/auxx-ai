CREATE TABLE "DataDeletionRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"confirmationCode" text NOT NULL,
	"provider" text NOT NULL,
	"externalId" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"organizationIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"integrationIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"receivedAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "DataDeletionRequest_confirmationCode_idx" ON "DataDeletionRequest" USING btree ("confirmationCode");--> statement-breakpoint
CREATE INDEX "DataDeletionRequest_provider_externalId_idx" ON "DataDeletionRequest" USING btree ("provider","externalId");--> statement-breakpoint
CREATE INDEX "Integration_social_userId_idx" ON "Integration" USING btree (("metadata" ->> 'userId')) WHERE "Integration"."deletedAt" IS NULL AND "Integration"."provider" IN ('facebook','instagram');