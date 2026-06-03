CREATE TYPE "public"."KnowledgeSourceStatus" AS ENUM('pending', 'syncing', 'live', 'error', 'paused');--> statement-breakpoint
CREATE TYPE "public"."KnowledgeSourceSurface" AS ENUM('publishable', 'ai-only');--> statement-breakpoint
CREATE TYPE "public"."KnowledgeSourceSyncBehavior" AS ENUM('manual', 'scheduled', 'webhook');--> statement-breakpoint
CREATE TABLE "KnowledgeSource" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"surface" "KnowledgeSourceSurface" DEFAULT 'publishable' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"targetKnowledgeBaseId" text NOT NULL,
	"rootFolderArticleId" text,
	"syncBehavior" "KnowledgeSourceSyncBehavior" DEFAULT 'manual' NOT NULL,
	"scheduleConfig" jsonb,
	"status" "KnowledgeSourceStatus" DEFAULT 'pending' NOT NULL,
	"lastSyncedAt" timestamp (3),
	"lastJobId" text,
	"itemCount" integer DEFAULT 0 NOT NULL,
	"error" text,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "sourceId" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "sourceExternalId" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "sourceContentHash" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_targetKnowledgeBaseId_KnowledgeBase_id_fk" FOREIGN KEY ("targetKnowledgeBaseId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_rootFolderArticleId_Article_id_fk" FOREIGN KEY ("rootFolderArticleId") REFERENCES "public"."Article"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "KnowledgeSource_organizationId_idx" ON "KnowledgeSource" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "KnowledgeSource_targetKnowledgeBaseId_idx" ON "KnowledgeSource" USING btree ("targetKnowledgeBaseId");--> statement-breakpoint
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_linkedFromSourceId_KnowledgeSource_id_fk" FOREIGN KEY ("linkedFromSourceId") REFERENCES "public"."KnowledgeSource"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Article" ADD CONSTRAINT "Article_sourceId_KnowledgeSource_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."KnowledgeSource"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Article_source_idx" ON "Article" USING btree ("sourceId","sourceExternalId");