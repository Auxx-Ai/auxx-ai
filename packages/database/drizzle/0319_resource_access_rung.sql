-- Plan v3/03 §3 — collapse ResourceAccess's two-column (permission, lens) grant
-- encoding onto ONE ordinal ladder: rung ∈ none < metadata < identity < read <
-- edit < admin.
--
-- Self-sufficient and idempotent (`feedback_migrations_self_sufficient`): the
-- backfill is INLINE, between ADD COLUMN and SET NOT NULL, so this file never
-- depends on a runtime DataMigration running between two schema migrations.
-- Order is load-bearing — the source columns must still exist when the UPDATE
-- runs, and the CHECK must be in place before they are dropped.
--
-- Mapping (total and lossless; verified against dev, 702 rows, 2026-07-29 —
-- zero rows carry a lens on anything but `view`):
--
--   permission | lens               | -> rung
--   -----------+--------------------+-----------
--   none       | any                | none
--   view       | 'metadata'         | metadata
--   view       | 'subject'          | identity
--   view       | 'full' or NULL     | read
--   edit       | any                | edit
--   admin      | any                | admin
--
-- The unique constraint `ResourceAccess_entity_grantee_key` is
-- (organizationId, entityDefinitionId, entityInstanceId, granteeType, granteeId)
-- NULLS NOT DISTINCT — it names NEITHER dropped column, so it is unaffected and
-- is deliberately left alone.

-- 1. ADD COLUMN, nullable, so the backfill has somewhere to write.
ALTER TABLE "ResourceAccess" ADD COLUMN IF NOT EXISTS "rung" text;--> statement-breakpoint

-- 2. INLINE BACKFILL.
--
--    Guarded on the SOURCE COLUMN STILL EXISTING, not just on `rung IS NULL`.
--    `WHERE "rung" IS NULL` alone makes the row set empty on a re-run but does
--    NOT make the statement parseable: step 5 drops `permission`, so a second
--    execution fails at plan time with `column "permission" does not exist`
--    before the WHERE is ever evaluated. Drizzle's journal means this file
--    normally runs once — but a half-failed run retried by hand is exactly when
--    idempotence is load-bearing, so the guard is real rather than nominal.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ResourceAccess' AND column_name = 'permission'
  ) THEN
    UPDATE "ResourceAccess" SET "rung" = CASE
      WHEN "permission" = 'none' THEN 'none'
      WHEN "permission" = 'view' AND "lens" = 'metadata' THEN 'metadata'
      WHEN "permission" = 'view' AND "lens" = 'subject' THEN 'identity'
      WHEN "permission" = 'view' THEN 'read'
      WHEN "permission" = 'edit' THEN 'edit'
      WHEN "permission" = 'admin' THEN 'admin'
    END
    WHERE "rung" IS NULL;
  END IF;
END $$;--> statement-breakpoint

-- 3. SET NOT NULL. An unmapped `permission` would leave a NULL and fail HERE,
--    loudly, with both source columns still present to diagnose from — rather
--    than silently landing an unreadable value on the ladder.
ALTER TABLE "ResourceAccess" ALTER COLUMN "rung" SET NOT NULL;--> statement-breakpoint

-- 4. ADD CHECK, before the source columns go, so no window exists in which the
--    table is rung-governed and unguarded.
DO $$ BEGIN
  ALTER TABLE "ResourceAccess" ADD CONSTRAINT "ResourceAccess_rung_check" CHECK ("ResourceAccess"."rung" IN ('none', 'metadata', 'identity', 'read', 'edit', 'admin'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- 5. DROP the replaced columns.
ALTER TABLE "ResourceAccess" DROP COLUMN IF EXISTS "permission";--> statement-breakpoint
ALTER TABLE "ResourceAccess" DROP COLUMN IF EXISTS "lens";--> statement-breakpoint

-- 6. The grantee-driven index (§3 / §5.1 arm 3). INCLUDE is hand-added:
--    drizzle-kit has no INCLUDE builder, and it diffs the schema against its own
--    snapshot JSON (never the live database), so the four-column definition in
--    `resource-access.ts` keeps future `db:generate` runs quiet.
CREATE INDEX IF NOT EXISTS "ResourceAccess_grantee_def_idx" ON "ResourceAccess" USING btree ("organizationId","granteeType","granteeId","entityDefinitionId") INCLUDE ("entityInstanceId","rung");
--> statement-breakpoint

-- 7. The SAME vocabulary rename on `ApprovalRequest`'s two lens columns (plan
--    v3/03 §3). They mirror `ResourceAccess`'s grant vocabulary by design, so
--    they must not be left holding the retired names — a request row saying
--    `full` would be compared against a ladder that has no such rung and read as
--    `undefined >= n`, i.e. false everywhere.
--
--    Idempotent by construction: the CASE only matches the OLD names, so a
--    re-run rewrites nothing. No CHECK is added here — unlike
--    `ResourceAccess.rung` these are nullable and set only for mail-sharing
--    rows, and the pair is still half of the older two-column encoding
--    (`requestedLevel` + this) that this phase deliberately does not collapse.
UPDATE "ApprovalRequest"
SET "requestedLens" = CASE "requestedLens" WHEN 'subject' THEN 'identity' WHEN 'full' THEN 'read' ELSE "requestedLens" END,
    "grantedLens"   = CASE "grantedLens"   WHEN 'subject' THEN 'identity' WHEN 'full' THEN 'read' ELSE "grantedLens"   END
WHERE "requestedLens" IN ('subject', 'full') OR "grantedLens" IN ('subject', 'full');
