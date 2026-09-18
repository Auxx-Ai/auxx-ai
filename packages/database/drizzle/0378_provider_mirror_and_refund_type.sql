CREATE TYPE "public"."ProviderLedgerAuthor" AS ENUM('auxx', 'provider');--> statement-breakpoint
ALTER TYPE "public"."GlPostingType" ADD VALUE 'refund' BEFORE 'invoice_issued';--> statement-breakpoint
CREATE TABLE "ProviderLedgerEntry" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"bookId" text NOT NULL,
	"providerTxnType" text NOT NULL,
	"providerTxnId" text NOT NULL,
	"txnDate" text NOT NULL,
	"docNumber" text,
	"syncToken" text,
	"author" "ProviderLedgerAuthor" NOT NULL,
	"raw" jsonb,
	"fetchedAt" timestamp (3) DEFAULT now() NOT NULL,
	"withdrawnAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProviderLedgerLine" (
	"id" text PRIMARY KEY NOT NULL,
	"entryId" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"providerAccountName" text,
	"direction" text NOT NULL,
	"amountMinor" bigint NOT NULL,
	"providerCustomerId" text,
	"providerVendorId" text,
	"memo" text,
	"sortOrder" bigint DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_bookId_ExternalAccountingBook_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."ExternalAccountingBook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderLedgerLine" ADD CONSTRAINT "ProviderLedgerLine_entryId_ProviderLedgerEntry_id_fk" FOREIGN KEY ("entryId") REFERENCES "public"."ProviderLedgerEntry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ProviderLedgerEntry_txn_key" ON "ProviderLedgerEntry" USING btree ("organizationId","bookId","providerTxnType","providerTxnId");--> statement-breakpoint
CREATE INDEX "ProviderLedgerEntry_range_idx" ON "ProviderLedgerEntry" USING btree ("organizationId","bookId","txnDate");--> statement-breakpoint
CREATE INDEX "ProviderLedgerEntry_author_idx" ON "ProviderLedgerEntry" USING btree ("organizationId","bookId","author");--> statement-breakpoint
CREATE INDEX "ProviderLedgerLine_entry_idx" ON "ProviderLedgerLine" USING btree ("entryId");