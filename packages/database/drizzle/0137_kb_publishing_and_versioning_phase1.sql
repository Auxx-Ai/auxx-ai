-- Phase 1 migration: KB publish status + Article revision-as-snapshot foundation
-- Adds new schema columns, deletes stale ArticleRevision diff rows, backfills
-- one draft revision per article + a published revision per published article,
-- and wires Article.draftRevisionId / publishedRevisionId pointers.

-- 1. Enum for KB publish state
CREATE TYPE "public"."KBPublishStatus" AS ENUM('DRAFT', 'PUBLISHED', 'UNLISTED');--> statement-breakpoint

-- 2. KnowledgeBase: add publish-status columns, backfill from isPublic, drop isPublic
ALTER TABLE "KnowledgeBase" ADD COLUMN "publishStatus" "KBPublishStatus" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD COLUMN "publishedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD COLUMN "lastPublishedAt" timestamp (3);--> statement-breakpoint

UPDATE "KnowledgeBase" SET "publishStatus" = 'PUBLISHED', "publishedAt" = NOW(), "lastPublishedAt" = NOW() WHERE "isPublic" = true;--> statement-breakpoint
ALTER TABLE "KnowledgeBase" DROP COLUMN "isPublic";--> statement-breakpoint

-- 3. Article: add revision pointers + publish metadata
ALTER TABLE "Article" ADD COLUMN "publishedRevisionId" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "draftRevisionId" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "publishedById" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "hasUnpublishedChanges" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 4. ArticleRevision: discard stale diff rows so we can repurpose the table
DELETE FROM "ArticleRevision";--> statement-breakpoint
ALTER TABLE "ArticleRevision" DROP COLUMN "previousContent";--> statement-breakpoint
ALTER TABLE "ArticleRevision" DROP COLUMN "previousContentJson";--> statement-breakpoint
ALTER TABLE "ArticleRevision" DROP COLUMN "wasCategory";--> statement-breakpoint

-- 5. ArticleRevision: add full-snapshot columns (safe to use NOT NULL since table is empty)
ALTER TABLE "ArticleRevision" ADD COLUMN "versionNumber" integer;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "title" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "excerpt" text;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "content" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "contentJson" jsonb;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "createdAt" timestamp (3) DEFAULT now() NOT NULL;--> statement-breakpoint

-- 6. Backfill: one draft revision per article (versionNumber NULL)
INSERT INTO "ArticleRevision" (
  "id", "articleId", "organizationId", "versionNumber",
  "title", "description", "excerpt", "emoji", "content", "contentJson",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, a."id", a."organizationId", NULL,
  a."title", a."description", a."excerpt", a."emoji", a."content", a."contentJson",
  NOW(), NOW()
FROM "Article" a;--> statement-breakpoint

-- 7. Backfill: one published revision per already-published article (versionNumber = 1)
INSERT INTO "ArticleRevision" (
  "id", "articleId", "organizationId", "versionNumber",
  "title", "description", "excerpt", "emoji", "content", "contentJson",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, a."id", a."organizationId", 1,
  a."title", a."description", a."excerpt", a."emoji", a."content", a."contentJson",
  NOW(), NOW()
FROM "Article" a
WHERE a."isPublished" = true;--> statement-breakpoint

-- 8. Wire up the FK pointers on Article
UPDATE "Article" a
SET "draftRevisionId" = (
  SELECT r."id" FROM "ArticleRevision" r
  WHERE r."articleId" = a."id" AND r."versionNumber" IS NULL
  LIMIT 1
);--> statement-breakpoint

UPDATE "Article" a
SET "publishedRevisionId" = (
  SELECT r."id" FROM "ArticleRevision" r
  WHERE r."articleId" = a."id" AND r."versionNumber" = 1
  LIMIT 1
)
WHERE a."isPublished" = true;--> statement-breakpoint

-- 9. FK constraints (after backfill so pointers are valid)
ALTER TABLE "Article" ADD CONSTRAINT "Article_publishedRevisionId_ArticleRevision_id_fk" FOREIGN KEY ("publishedRevisionId") REFERENCES "public"."ArticleRevision"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Article" ADD CONSTRAINT "Article_draftRevisionId_ArticleRevision_id_fk" FOREIGN KEY ("draftRevisionId") REFERENCES "public"."ArticleRevision"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Article" ADD CONSTRAINT "Article_publishedById_User_id_fk" FOREIGN KEY ("publishedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint

-- 10. Indexes
CREATE INDEX "ArticleRevision_articleId_idx" ON "ArticleRevision" USING btree ("articleId");--> statement-breakpoint
CREATE UNIQUE INDEX "ArticleRevision_articleId_versionNumber_key" ON "ArticleRevision" USING btree ("articleId","versionNumber" DESC NULLS LAST) WHERE "versionNumber" IS NOT NULL;
