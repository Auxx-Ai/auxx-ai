ALTER TABLE "Thread" ADD COLUMN "searchText" text;--> statement-breakpoint
CREATE INDEX "Thread_org_searchText_gin_idx" ON "Thread" USING gin ("organizationId",to_tsvector('english'::regconfig, COALESCE("searchText", '')));--> statement-breakpoint
CREATE INDEX "Thread_org_subject_gin_idx" ON "Thread" USING gin ("organizationId",to_tsvector('english'::regconfig, COALESCE("subject", '')));--> statement-breakpoint
CREATE INDEX "Thread_org_subject_trgm_idx" ON "Thread" USING gin ("organizationId","subject" gin_trgm_ops);