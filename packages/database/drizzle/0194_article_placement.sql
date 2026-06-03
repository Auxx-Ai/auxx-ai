CREATE TABLE "ArticlePlacement" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"articleId" text NOT NULL,
	"knowledgeBaseId" text NOT NULL,
	"slug" text NOT NULL,
	"parentId" text,
	"sortOrder" text COLLATE "C" DEFAULT 'a0' NOT NULL,
	"isPublished" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp (3),
	"publishedRevisionId" text,
	"publishedById" text,
	"hasUnpublishedChanges" boolean DEFAULT false NOT NULL,
	"linkedFromSourceId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Article" DROP CONSTRAINT "Article_knowledgeBaseId_KnowledgeBase_id_fk";
--> statement-breakpoint
ALTER TABLE "Article" DROP CONSTRAINT "Article_parentId_Article_id_fk";
--> statement-breakpoint
ALTER TABLE "Article" DROP CONSTRAINT "Article_publishedRevisionId_ArticleRevision_id_fk";
--> statement-breakpoint
ALTER TABLE "Article" DROP CONSTRAINT "Article_publishedById_User_id_fk";
--> statement-breakpoint
DROP INDEX "Article_knowledgeBaseId_idx";--> statement-breakpoint
DROP INDEX "Article_knowledgeBaseId_slug_key";--> statement-breakpoint
DROP INDEX "Article_parentId_idx";--> statement-breakpoint
DROP INDEX "Article_kb_parent_sortOrder_idx";--> statement-breakpoint
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_articleId_Article_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."Article"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_knowledgeBaseId_KnowledgeBase_id_fk" FOREIGN KEY ("knowledgeBaseId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_parentId_ArticlePlacement_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."ArticlePlacement"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_publishedRevisionId_ArticleRevision_id_fk" FOREIGN KEY ("publishedRevisionId") REFERENCES "public"."ArticleRevision"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_publishedById_User_id_fk" FOREIGN KEY ("publishedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ArticlePlacement_kb_slug_key" ON "ArticlePlacement" USING btree ("knowledgeBaseId","slug");--> statement-breakpoint
CREATE INDEX "ArticlePlacement_kb_parent_sortOrder_idx" ON "ArticlePlacement" USING btree ("knowledgeBaseId","parentId","sortOrder");--> statement-breakpoint
CREATE INDEX "ArticlePlacement_articleId_idx" ON "ArticlePlacement" USING btree ("articleId");--> statement-breakpoint
CREATE INDEX "ArticlePlacement_knowledgeBaseId_idx" ON "ArticlePlacement" USING btree ("knowledgeBaseId");--> statement-breakpoint
CREATE INDEX "ArticlePlacement_parentId_idx" ON "ArticlePlacement" USING btree ("parentId");--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "homeKnowledgeBaseId" text;--> statement-breakpoint
INSERT INTO "ArticlePlacement" (
	"id", "organizationId", "articleId", "knowledgeBaseId", "slug", "parentId", "sortOrder",
	"isPublished", "publishedAt", "publishedRevisionId", "publishedById", "hasUnpublishedChanges",
	"createdAt", "updatedAt"
)
SELECT
	gen_random_uuid()::text, a."organizationId", a."id", a."knowledgeBaseId", a."slug", NULL,
	a."sortOrder", a."isPublished", a."publishedAt", a."publishedRevisionId", a."publishedById",
	a."hasUnpublishedChanges", a."createdAt", a."updatedAt"
FROM "Article" a;--> statement-breakpoint
UPDATE "ArticlePlacement" p
SET "parentId" = parent_p."id"
FROM "Article" a
JOIN "ArticlePlacement" parent_p ON parent_p."articleId" = a."parentId"
WHERE p."articleId" = a."id" AND a."parentId" IS NOT NULL;--> statement-breakpoint
UPDATE "Article" SET "homeKnowledgeBaseId" = "knowledgeBaseId";--> statement-breakpoint
ALTER TABLE "Article" ALTER COLUMN "homeKnowledgeBaseId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Article" ADD CONSTRAINT "Article_homeKnowledgeBaseId_KnowledgeBase_id_fk" FOREIGN KEY ("homeKnowledgeBaseId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Article_homeKnowledgeBaseId_idx" ON "Article" USING btree ("homeKnowledgeBaseId");--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "knowledgeBaseId";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "parentId";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "sortOrder";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "isPublished";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "publishedAt";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "publishedRevisionId";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "publishedById";--> statement-breakpoint
ALTER TABLE "Article" DROP COLUMN "hasUnpublishedChanges";
