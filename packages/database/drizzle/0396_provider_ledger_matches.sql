ALTER TABLE "MoneyTransaction" ADD COLUMN "providerLedgerEntryId" text;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD COLUMN "matchState" text;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD COLUMN "matchReason" text;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD COLUMN "matchedKind" text;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD COLUMN "matchedId" text;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD COLUMN "matchedBy" text;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD COLUMN "matchedAt" timestamp (3);--> statement-breakpoint
CREATE UNIQUE INDEX "MoneyTransaction_provider_entry_key" ON "MoneyTransaction" USING btree ("organizationId","providerLedgerEntryId");--> statement-breakpoint
CREATE INDEX "ProviderLedgerEntry_open_match_idx" ON "ProviderLedgerEntry" USING btree ("organizationId","matchState") WHERE "ProviderLedgerEntry"."matchState" IN ('pending', 'suggested', 'unmatchable');--> statement-breakpoint
CREATE INDEX "ProviderLedgerEntry_matched_idx" ON "ProviderLedgerEntry" USING btree ("organizationId","matchedId");