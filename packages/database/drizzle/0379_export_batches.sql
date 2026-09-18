CREATE TABLE "ExportBatch" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"bookId" text NOT NULL,
	"connectionId" text NOT NULL,
	"mode" text NOT NULL,
	"avenue" text NOT NULL,
	"grainKey" text NOT NULL,
	"storeId" text,
	"railId" text,
	"currency" text NOT NULL,
	"objectType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payloadHash" text NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"providerObjectId" text,
	"providerSyncToken" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"lastError" text,
	"totalMinor" bigint DEFAULT 0 NOT NULL,
	"sentAt" timestamp with time zone,
	"withdrawnAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ExportBatch_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "ExportBatch_state_check" CHECK ("ExportBatch"."state" IN ('ready','sending','sent','failed','withdrawn') AND "ExportBatch"."mode" IN ('transaction','summary') AND "ExportBatch"."attempts" >= 0),
	CONSTRAINT "ExportBatch_payloadHash_check" CHECK ("ExportBatch"."payloadHash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ExportBatchPosting" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"batchId" text NOT NULL,
	"glPostingId" text NOT NULL,
	"withdrawnAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AccountingDelivery" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryCoverage" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryOperation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ExternalAccountingObject" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "AccountingDelivery" CASCADE;--> statement-breakpoint
DROP TABLE "AccountingDeliveryCoverage" CASCADE;--> statement-breakpoint
DROP TABLE "AccountingDeliveryOperation" CASCADE;--> statement-breakpoint
DROP TABLE "ExternalAccountingObject" CASCADE;--> statement-breakpoint
ALTER TABLE "GlPosting" DROP CONSTRAINT "GlPosting_attempts_check";--> statement-breakpoint
DROP INDEX "GlPosting_org_provider_entry_key";--> statement-breakpoint
DROP INDEX "GlPosting_org_exportStatus_idx";--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD COLUMN "quoteInstanceId" text;--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_book_scope_fk" FOREIGN KEY ("organizationId","bookId") REFERENCES "public"."ExternalAccountingBook"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_connection_scope_fk" FOREIGN KEY ("organizationId","connectionId") REFERENCES "public"."ExternalBookConnection"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatchPosting" ADD CONSTRAINT "ExportBatchPosting_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatchPosting" ADD CONSTRAINT "ExportBatchPosting_batch_scope_fk" FOREIGN KEY ("organizationId","batchId") REFERENCES "public"."ExportBatch"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatchPosting" ADD CONSTRAINT "ExportBatchPosting_posting_scope_fk" FOREIGN KEY ("organizationId","glPostingId") REFERENCES "public"."GlPosting"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ExportBatch_grain_key" ON "ExportBatch" USING btree ("organizationId","bookId","avenue","grainKey",coalesce("storeId", ''),coalesce("railId", ''),"currency") WHERE "ExportBatch"."state" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "ExportBatch_org_state_idx" ON "ExportBatch" USING btree ("organizationId","state");--> statement-breakpoint
CREATE INDEX "ExportBatch_sweep_idx" ON "ExportBatch" USING btree ("state","nextAttemptAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ExportBatchPosting_live_posting_key" ON "ExportBatchPosting" USING btree ("organizationId","glPostingId") WHERE "ExportBatchPosting"."withdrawnAt" IS NULL;--> statement-breakpoint
CREATE INDEX "ExportBatchPosting_batch_idx" ON "ExportBatchPosting" USING btree ("organizationId","batchId");--> statement-breakpoint
CREATE INDEX "MoneyApplication_quote_idx" ON "MoneyApplication" USING btree ("organizationId","quoteInstanceId");--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "requestId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "exportStatus";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "providerId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "providerEntryId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "providerTenantId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "failureReason";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "attempts";--> statement-breakpoint
DROP TYPE "public"."GlPostingExportStatus";