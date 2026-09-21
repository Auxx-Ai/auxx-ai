-- tasks/77: a draft's subject is now its own `pending` link on GlPostingSource.
-- Hand-added to the generated diff - every standing draft gets the row the
-- ledger would have written, read off its `built.sources` envelope.
INSERT INTO "GlPostingSource" ("id", "organizationId", "glPostingId", "sourceKind", "sourceId", "linkRole", "occurrence")
SELECT
  'pend' || substr(md5(p."id" || ':' || (s->>'sourceKind') || ':' || (s->>'sourceId')), 1, 20),
  p."organizationId",
  p."id",
  s->>'sourceKind',
  s->>'sourceId',
  'pending',
  coalesce(s->>'occurrence', 'original')
FROM "GlPosting" p, jsonb_array_elements(p."built"->'sources') s
-- `::text`: on a fresh database every migration runs in one transaction, and
-- `draft` joined the enum in 0383, so the value cannot be used as an enum yet.
WHERE p."status"::text = 'draft'
  AND s->>'linkRole' = 'subject'
  AND NOT EXISTS (
    SELECT 1 FROM "GlPostingSource" existing
    WHERE existing."glPostingId" = p."id" AND existing."linkRole" = 'pending'
  );--> statement-breakpoint
-- The per-document pointer the `pending` row replaces. `generation` stays.
UPDATE "EntityInstance"
SET "metadata" = "metadata" #- '{ledger,draftGlPostingId}'
WHERE "metadata" -> 'ledger' ? 'draftGlPostingId';--> statement-breakpoint
ALTER TABLE "MoneyTransaction" DROP COLUMN "draftGlPostingId";
