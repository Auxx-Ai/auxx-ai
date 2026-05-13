ALTER TABLE "ArticleRevision" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "color" text;--> statement-breakpoint
UPDATE "Article" a SET
  "emoji" = COALESCE(pr."emoji", dr."emoji"),
  "color" = COALESCE(pr."color", dr."color")
FROM (SELECT id FROM "Article") base
LEFT JOIN "ArticleRevision" pr ON pr."id" = (SELECT "publishedRevisionId" FROM "Article" WHERE "id" = base.id)
LEFT JOIN "ArticleRevision" dr ON dr."id" = (SELECT "draftRevisionId" FROM "Article" WHERE "id" = base.id)
WHERE a."id" = base.id;