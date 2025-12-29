ALTER TABLE "Dataset" ADD COLUMN "chunkSettings" jsonb DEFAULT '{"strategy":"FIXED_SIZE","size":1000,"overlap":200,"delimiter":null,"preprocessing":{"normalizeWhitespace":true,"removeUrlsAndEmails":false}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Dataset" DROP COLUMN "chunkSize";--> statement-breakpoint
ALTER TABLE "Dataset" DROP COLUMN "chunkOverlap";--> statement-breakpoint
ALTER TABLE "Dataset" DROP COLUMN "chunkingStrategy";