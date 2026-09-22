ALTER TABLE "GlPosting" ADD COLUMN "payoutId" text;--> statement-breakpoint
CREATE INDEX "GlPosting_org_payoutId_idx" ON "GlPosting" USING btree ("organizationId","payoutId");