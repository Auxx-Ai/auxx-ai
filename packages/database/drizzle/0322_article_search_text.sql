ALTER TABLE "Article" ADD COLUMN "searchText" text;--> statement-breakpoint
CREATE INDEX "Article_org_searchText_gin_idx" ON "Article" USING gin ("organizationId",to_tsvector('english'::regconfig, COALESCE("searchText", '')));--> statement-breakpoint
CREATE INDEX "Article_org_title_trgm_idx" ON "Article" USING gin ("organizationId","title" gin_trgm_ops);