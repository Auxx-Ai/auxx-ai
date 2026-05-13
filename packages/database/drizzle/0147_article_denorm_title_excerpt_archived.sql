ALTER TABLE "Article" ADD COLUMN "archived_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "excerpt" text;--> statement-breakpoint
CREATE INDEX "Article_title_idx" ON "Article" USING btree ("title");--> statement-breakpoint
CREATE INDEX "Article_archived_at_idx" ON "Article" USING btree ("archived_at");--> statement-breakpoint
UPDATE "Article" a SET
  "title" = COALESCE(pr."title", dr."title"),
  "excerpt" = COALESCE(pr."excerpt", dr."excerpt")
FROM (SELECT id FROM "Article") base
LEFT JOIN "ArticleRevision" pr ON pr."id" = (SELECT "publishedRevisionId" FROM "Article" WHERE "id" = base.id)
LEFT JOIN "ArticleRevision" dr ON dr."id" = (SELECT "draftRevisionId" FROM "Article" WHERE "id" = base.id)
WHERE a."id" = base.id;
