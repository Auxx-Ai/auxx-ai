CREATE TYPE "public"."GlPostingDirection" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."GlPostingStatus" AS ENUM('pending', 'posted', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."GlPostingType" AS ENUM('fulfillment', 'payout', 'build', 'month_end_deferral', 'month_end_reversal', 'month_end_inventory', 'receipt', 'vendor_bill');--> statement-breakpoint
CREATE TABLE "GlPostingLine" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"glPostingId" text NOT NULL,
	"lineNumber" integer NOT NULL,
	"accountCode" text NOT NULL,
	"accountRole" text,
	"accountName" text,
	"direction" "GlPostingDirection" NOT NULL,
	"amountMinor" integer NOT NULL,
	"memo" text,
	"sourceType" text NOT NULL,
	"sourceId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "GlPostingLine_amount_check" CHECK ("GlPostingLine"."amountMinor" > 0),
	CONSTRAINT "GlPostingLine_accountCode_check" CHECK (length(trim("GlPostingLine"."accountCode")) > 0),
	CONSTRAINT "GlPostingLine_lineNumber_check" CHECK ("GlPostingLine"."lineNumber" > 0)
);
--> statement-breakpoint
CREATE TABLE "GlPosting" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"postingType" "GlPostingType" NOT NULL,
	"periodKey" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" "GlPostingStatus" DEFAULT 'pending' NOT NULL,
	"txnDate" date NOT NULL,
	"docNumber" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"totalMinor" integer NOT NULL,
	"draft" jsonb NOT NULL,
	"requestId" text NOT NULL,
	"providerId" text,
	"providerEntryId" text,
	"postedAt" timestamp (3),
	"postedByUserId" text,
	"failureReason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reversesId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "GlPosting_totalMinor_check" CHECK ("GlPosting"."totalMinor" >= 0),
	CONSTRAINT "GlPosting_revision_check" CHECK ("GlPosting"."revision" >= 0),
	CONSTRAINT "GlPosting_attempts_check" CHECK ("GlPosting"."attempts" >= 0),
	CONSTRAINT "GlPosting_reversal_check" CHECK (("GlPosting"."revision" = 0 AND "GlPosting"."reversesId" IS NULL) OR ("GlPosting"."revision" > 0 AND "GlPosting"."reversesId" IS NOT NULL)),
	CONSTRAINT "GlPosting_posted_check" CHECK ("GlPosting"."status" <> 'posted' OR "GlPosting"."postedAt" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "GlPostingLine" ADD CONSTRAINT "GlPostingLine_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "GlPostingLine" ADD CONSTRAINT "GlPostingLine_glPostingId_GlPosting_id_fk" FOREIGN KEY ("glPostingId") REFERENCES "public"."GlPosting"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_postedByUserId_User_id_fk" FOREIGN KEY ("postedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_reversesId_GlPosting_id_fk" FOREIGN KEY ("reversesId") REFERENCES "public"."GlPosting"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "GlPostingLine_posting_lineNumber_key" ON "GlPostingLine" USING btree ("glPostingId","lineNumber");--> statement-breakpoint
CREATE INDEX "GlPostingLine_org_accountCode_idx" ON "GlPostingLine" USING btree ("organizationId","accountCode");--> statement-breakpoint
CREATE INDEX "GlPostingLine_org_source_idx" ON "GlPostingLine" USING btree ("organizationId","sourceType","sourceId");--> statement-breakpoint
CREATE INDEX "GlPostingLine_glPostingId_idx" ON "GlPostingLine" USING btree ("glPostingId");--> statement-breakpoint
CREATE UNIQUE INDEX "GlPosting_org_type_period_revision_key" ON "GlPosting" USING btree ("organizationId","postingType","periodKey","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "GlPosting_org_docNumber_key" ON "GlPosting" USING btree ("organizationId","docNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "GlPosting_org_provider_entry_key" ON "GlPosting" USING btree ("organizationId","providerId","providerEntryId") WHERE "GlPosting"."providerEntryId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "GlPosting_org_status_idx" ON "GlPosting" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "GlPosting_org_txnDate_idx" ON "GlPosting" USING btree ("organizationId","txnDate");--> statement-breakpoint
CREATE INDEX "GlPosting_reversesId_idx" ON "GlPosting" USING btree ("reversesId");