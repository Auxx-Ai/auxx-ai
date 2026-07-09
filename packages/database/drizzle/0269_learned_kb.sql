ALTER TYPE "public"."KBKind" ADD VALUE 'learned';--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "learnedProvenance" jsonb;--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "learnedExtractedAt" timestamp (3);