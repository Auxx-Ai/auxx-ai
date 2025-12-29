CREATE TABLE "SystemModelDefault" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"modelType" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Dataset" ALTER COLUMN "chunkSettings" SET DEFAULT '{"strategy":"FIXED_SIZE","size":1024,"overlap":50,"delimiter":"\n\n","preprocessing":{"normalizeWhitespace":true,"removeUrlsAndEmails":false}}'::jsonb;--> statement-breakpoint
ALTER TABLE "SystemModelDefault" ADD CONSTRAINT "SystemModelDefault_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "SystemModelDefault_organizationId_modelType_key" ON "SystemModelDefault" USING btree ("organizationId","modelType");--> statement-breakpoint
CREATE INDEX "SystemModelDefault_organizationId_idx" ON "SystemModelDefault" USING btree ("organizationId");