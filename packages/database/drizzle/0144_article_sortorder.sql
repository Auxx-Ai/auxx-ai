ALTER TABLE "Article" ADD COLUMN "sortOrder" text COLLATE "C" DEFAULT 'a0' NOT NULL;--> statement-breakpoint
CREATE INDEX "Article_kb_parent_sortOrder_idx" ON "Article" USING btree ("knowledgeBaseId","parentId","sortOrder");--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "order";