CREATE TYPE "public"."articleKind" AS ENUM('page', 'category', 'header', 'tab');--> statement-breakpoint
DROP INDEX "Article_isCategory_idx";--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "articleKind" "articleKind" DEFAULT 'page' NOT NULL;--> statement-breakpoint
CREATE INDEX "Article_articleKind_idx" ON "Article" USING btree ("articleKind");--> statement-breakpoint
-- Backfill articleKind from the legacy isCategory flag before we drop the column.
UPDATE "Article" SET "articleKind" = 'category' WHERE "isCategory" = true;--> statement-breakpoint
-- Seed one undeletable tab per KnowledgeBase. We pick a stable id derived from
-- the KB id so the migration is idempotent on a clean DB.
WITH new_tabs AS (
  INSERT INTO "Article" (
    "id", "slug", "articleKind", "status", "createdAt", "updatedAt",
    "viewsCount", "knowledgeBaseId", "organizationId", "parentId", "order",
    "isPublished", "publishedAt", "hasUnpublishedChanges"
  )
  SELECT
    'tab_' || kb."id",
    'docs',
    'tab'::"articleKind",
    'PUBLISHED',
    NOW(),
    NOW(),
    0,
    kb."id",
    kb."organizationId",
    NULL,
    0,
    true,
    NOW(),
    false
  FROM "KnowledgeBase" kb
  WHERE NOT EXISTS (
    SELECT 1 FROM "Article" a
    WHERE a."knowledgeBaseId" = kb."id" AND a."articleKind" = 'tab'
  )
  ON CONFLICT ("knowledgeBaseId", "slug") DO NOTHING
  RETURNING "id", "knowledgeBaseId", "organizationId"
),
new_revisions AS (
  INSERT INTO "ArticleRevision" (
    "id", "articleId", "organizationId", "versionNumber", "title",
    "content", "createdAt", "updatedAt"
  )
  SELECT
    'rev_' || nt."id",
    nt."id",
    nt."organizationId",
    1,
    'Documentation',
    '',
    NOW(),
    NOW()
  FROM new_tabs nt
  RETURNING "id", "articleId"
)
UPDATE "Article" a
SET "publishedRevisionId" = nr."id", "draftRevisionId" = nr."id"
FROM new_revisions nr
WHERE a."id" = nr."articleId";--> statement-breakpoint
-- Reparent every existing root-level non-tab article under its KB's tab.
UPDATE "Article" child
SET "parentId" = tab."id", "order" = child."order" + 1
FROM "Article" tab
WHERE tab."articleKind" = 'tab'
  AND tab."knowledgeBaseId" = child."knowledgeBaseId"
  AND child."parentId" IS NULL
  AND child."articleKind" <> 'tab';--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "isCategory";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "isHomePage";
