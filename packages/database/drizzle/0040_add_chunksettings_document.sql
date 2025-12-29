ALTER TABLE "Document" ADD COLUMN "chunkSettings" jsonb;--> statement-breakpoint
ALTER TABLE "Dataset" DROP COLUMN "embeddingModelProvider";