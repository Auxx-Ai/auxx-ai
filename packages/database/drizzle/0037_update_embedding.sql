-- Rename existing embedding column to embedding_1536 (preserves existing 1536-dimension data)
ALTER TABLE "DocumentSegment" RENAME COLUMN "embedding" TO "embedding_1536";--> statement-breakpoint

-- Drop old indexes
DROP INDEX IF EXISTS "idx_document_segment_active_embedding";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_document_segment_dataset_filter";--> statement-breakpoint

-- Add new embedding columns for other dimensions
ALTER TABLE "DocumentSegment" ADD COLUMN "embedding_512" vector(512);--> statement-breakpoint
ALTER TABLE "DocumentSegment" ADD COLUMN "embedding_768" vector(768);--> statement-breakpoint
ALTER TABLE "DocumentSegment" ADD COLUMN "embedding_1024" vector(1024);--> statement-breakpoint
ALTER TABLE "DocumentSegment" ADD COLUMN "embedding_3072" vector(3072);--> statement-breakpoint

-- Add embeddingDimension column to track which dimension is used
ALTER TABLE "DocumentSegment" ADD COLUMN "embeddingDimension" integer;--> statement-breakpoint

-- Set embeddingDimension for existing rows that have embeddings
UPDATE "DocumentSegment" SET "embeddingDimension" = 1536 WHERE "embedding_1536" IS NOT NULL;--> statement-breakpoint

-- Create partial HNSW indexes for dimensions <= 2000 (pgvector max is 2000 for indexed columns)
CREATE INDEX "idx_embedding_512_hnsw" ON "DocumentSegment" USING hnsw ("embedding_512" vector_cosine_ops) WITH (m=16,ef_construction=64) WHERE (embedding_512 IS NOT NULL AND enabled = true AND "indexStatus" = 'INDEXED'::"IndexStatus");--> statement-breakpoint
CREATE INDEX "idx_embedding_768_hnsw" ON "DocumentSegment" USING hnsw ("embedding_768" vector_cosine_ops) WITH (m=16,ef_construction=64) WHERE (embedding_768 IS NOT NULL AND enabled = true AND "indexStatus" = 'INDEXED'::"IndexStatus");--> statement-breakpoint
CREATE INDEX "idx_embedding_1024_hnsw" ON "DocumentSegment" USING hnsw ("embedding_1024" vector_cosine_ops) WITH (m=16,ef_construction=64) WHERE (embedding_1024 IS NOT NULL AND enabled = true AND "indexStatus" = 'INDEXED'::"IndexStatus");--> statement-breakpoint
CREATE INDEX "idx_embedding_1536_hnsw" ON "DocumentSegment" USING hnsw ("embedding_1536" vector_cosine_ops) WITH (m=16,ef_construction=64) WHERE (embedding_1536 IS NOT NULL AND enabled = true AND "indexStatus" = 'INDEXED'::"IndexStatus");--> statement-breakpoint

-- NOTE: embedding_3072 column has no index (pgvector max indexed dimension is 2000)
-- Queries on 3072-dimension embeddings will use sequential scan (slower but functional)

-- Recreate dataset filter index (without embedding dependency)
CREATE INDEX "idx_document_segment_dataset_filter" ON "DocumentSegment" USING btree ("documentId") WHERE ((enabled = true) AND ("indexStatus" = 'INDEXED'::"IndexStatus"));