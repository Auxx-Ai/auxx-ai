ALTER TABLE "embedding_jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "embeddings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "embedding_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "embeddings" CASCADE;--> statement-breakpoint
ALTER TABLE "Dataset" ADD COLUMN "isManaged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD COLUMN "datasetId" text;--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_datasetId_Dataset_id_fk" FOREIGN KEY ("datasetId") REFERENCES "public"."Dataset"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_dataset_org_managed" ON "Dataset" USING btree ("organizationId","isManaged");--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "embedding";