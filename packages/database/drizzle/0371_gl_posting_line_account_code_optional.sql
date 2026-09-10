ALTER TABLE "GlPostingLine" DROP CONSTRAINT "GlPostingLine_accountCode_check";--> statement-breakpoint
ALTER TABLE "GlPostingLine" ALTER COLUMN "accountCode" DROP NOT NULL;