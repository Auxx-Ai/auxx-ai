-- The 0142 migration's nested CTE failed to wire up tab revision pointers in
-- PostgreSQL — the inner UPDATE didn't fire, leaving every seeded tab with
-- NULL draftRevisionId / publishedRevisionId. Backfill from ArticleRevision.
UPDATE "Article" a
SET "draftRevisionId" = r."id",
    "publishedRevisionId" = r."id"
FROM "ArticleRevision" r
WHERE a."articleKind" = 'tab'
  AND a."draftRevisionId" IS NULL
  AND r."articleId" = a."id";
