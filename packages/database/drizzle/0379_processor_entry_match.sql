ALTER TABLE "ProcessorBalanceEntry" ADD COLUMN "matchState" text;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD COLUMN "matchedMoneyTransactionId" text;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD COLUMN "matchReason" text;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD COLUMN "matchedBy" text;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD COLUMN "matchedAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ProcessorBalanceEntry_matched_money_idx" ON "ProcessorBalanceEntry" USING btree ("organizationId","matchedMoneyTransactionId");--> statement-breakpoint
CREATE INDEX "ProcessorBalanceEntry_open_match_idx" ON "ProcessorBalanceEntry" USING btree ("organizationId","matchState") WHERE "ProcessorBalanceEntry"."matchState" IN ('pending', 'suggested', 'unmatchable');