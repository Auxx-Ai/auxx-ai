-- Drop the existing searchVector column and recreate as a generated stored column
ALTER TABLE "DocumentSegment" DROP COLUMN IF EXISTS "searchVector";
ALTER TABLE "DocumentSegment" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Recreate the GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "idx_document_segment_search_vector" ON "DocumentSegment" USING gin ("searchVector");
