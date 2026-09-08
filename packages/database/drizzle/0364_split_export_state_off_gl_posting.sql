CREATE TYPE "public"."GlPostingExportStatus" AS ENUM('not_required', 'pending', 'exported', 'failed');--> statement-breakpoint
ALTER TABLE "GlPosting" ADD COLUMN "exportStatus" "GlPostingExportStatus" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
DO $$
DECLARE stuck integer;
BEGIN
  SELECT count(*) INTO stuck FROM "GlPosting" WHERE "status"::text = 'failed';
  IF stuck > 0 THEN
    RAISE EXCEPTION
      'GlPosting still holds % row(s) with status=failed. Clear them first: reset-accounting.ts <org> --failed-only --confirm. They are NOT converted automatically because a failed row''s ledger content was valid while its DOCUMENT may have been rolled back underneath it (bank_deposit archives the deposit and releases its payments), so flipping one to posted books a deposit that no longer exists. See plans/accounting/export-state-split.md section 4.', stuck;
  END IF;
END $$;--> statement-breakpoint
UPDATE "GlPosting" SET "exportStatus" = CASE
    WHEN "providerEntryId" IS NOT NULL THEN 'exported'
    WHEN "status"::text = 'pending' THEN 'pending'
    ELSE 'not_required'
  END::"public"."GlPostingExportStatus";--> statement-breakpoint
UPDATE "GlPosting"
  SET "status" = 'posted', "postedAt" = COALESCE("postedAt", "createdAt")
  WHERE "status"::text = 'pending';--> statement-breakpoint
-- `GlPosting_posted_check` stores its literal as 'posted'::"GlPostingStatus". Casting the
-- column to text mid-swap leaves the constraint comparing text <> "GlPostingStatus", for which
-- no operator exists, so it has to come off before the type dance and go back on after.
ALTER TABLE "GlPosting" DROP CONSTRAINT "GlPosting_posted_check";--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."GlPostingStatus";--> statement-breakpoint
CREATE TYPE "public"."GlPostingStatus" AS ENUM('posted', 'reversed');--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" SET DATA TYPE "public"."GlPostingStatus" USING "status"::"public"."GlPostingStatus";--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" SET DEFAULT 'posted'::"public"."GlPostingStatus";--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_posted_check" CHECK ("GlPosting"."status" <> 'posted' OR "GlPosting"."postedAt" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "GlPosting_org_exportStatus_idx" ON "GlPosting" USING btree ("organizationId","exportStatus");
