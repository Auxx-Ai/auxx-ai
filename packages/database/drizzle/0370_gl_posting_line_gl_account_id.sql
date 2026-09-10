-- plans/accounting/tasks/17-accounting-is-opt-in.md §1 and
-- plans/accounting/tasks/15-the-account-id-is-the-identity.md §2 (decided
-- 2026-09-09): nothing real exists in GlPostingLine / GlPosting yet, every
-- organization in the database is test data and no ledger holds a real book.
-- Wiping both tables here is what lets glAccountId land NOT NULL with no
-- backfill and no re-resolution step.
DELETE FROM "GlPostingLine";--> statement-breakpoint
DELETE FROM "GlPosting";--> statement-breakpoint
ALTER TABLE "GlPostingLine" ADD COLUMN "glAccountId" text NOT NULL;--> statement-breakpoint
CREATE INDEX "GlPostingLine_org_glAccountId_idx" ON "GlPostingLine" USING btree ("organizationId","glAccountId");
