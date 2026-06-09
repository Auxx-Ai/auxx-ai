ALTER TABLE "AiUsage" ADD COLUMN "cachedInputTokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "AiUsage" ADD COLUMN "cacheWriteTokens" integer DEFAULT 0 NOT NULL;